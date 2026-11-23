/** @odoo-module */
/*
 * Pharmacy POS — Odoo 17 point-of-sale interface
 * Author: Hamdy Mahran
 */

import { _t } from "@web/core/l10n/translation";
import { patch } from "@web/core/utils/patch";
import { useService } from "@web/core/utils/hooks";
import { Component, useState, onMounted, markup } from "@odoo/owl";
import { PosStore } from "@point_of_sale/app/store/pos_store";
import { usePos } from "@point_of_sale/app/store/pos_hook";
import { Product, Order, Orderline } from "@point_of_sale/app/store/models";
import { ProductScreen } from "@point_of_sale/app/screens/product_screen/product_screen";
import { PaymentScreen } from "@point_of_sale/app/screens/payment_screen/payment_screen";
import { AbstractAwaitablePopup } from "@point_of_sale/app/popup/abstract_awaitable_popup";
import { ErrorPopup } from "@point_of_sale/app/errors/popups/error_popup";
import { ConfirmPopup } from "@point_of_sale/app/utils/confirm_popup/confirm_popup";
import { NumberPopup } from "@point_of_sale/app/utils/input_popups/number_popup";

    // ==================================================================
    // منطق الصيدلية المشترك (لا يعتمد على إصدار أودو)
    // ==================================================================
    function makeState(data) {
        data = data || {};
        return {
            cfg: data.config || {},
            flags: data.products || {},
            lots: data.lots || {},
            promotions: data.promotions || [],
            loyalty: data.loyalty || false,
        };
    }
    function flagsOf(st, pid) {
        return (st && st.flags[pid]) || {};
    }
    function lotsOf(st, pid) {
        return (st && st.lots[pid]) || [];
    }
    // FEFO: أقرب دفعة صالحة انتهاءً، والدفعات بدون تاريخ في الأخير
    function bestLot(st, pid) {
        const lots = lotsOf(st, pid).filter((l) => l.expiry_status !== "expired");
        lots.sort((a, b) => ((a.expiry_date || "9999") < (b.expiry_date || "9999") ? -1 : 1));
        return lots[0] || null;
    }
    function onlyExpired(st, pid) {
        const lots = lotsOf(st, pid);
        return lots.length > 0 && lots.every((l) => l.expiry_status === "expired");
    }
    function autoLotFor(st, product) {
        if (!st || !st.cfg.pharmacy_mode || !flagsOf(st, product.id).is_pharmaceutical) {
            return null;
        }
        return bestLot(st, product.id);
    }
    function promoDiscount(st, pid, qty) {
        let best = 0;
        for (const p of (st && st.cfg.enable_promotions && st.promotions) || []) {
            if (!p.product_ids.includes(pid)) {
                continue;
            }
            if (p.promo_type === "qty_discount" && qty < p.min_qty) {
                continue;
            }
            best = Math.max(best, p.discount_percent);
        }
        return best;
    }
    function esc(value) {
        return String(value === undefined || value === null ? "" : value)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }
    function money(v) {
        return (Number(v) || 0).toFixed(2);
    }
    function receiptHtml(d) {
        const cur = esc(d.currency || "ريال");
        const rows = (d.lines || []).map((l) =>
            `<tr><td style="text-align:right;">${esc(l.product)}</td><td style="text-align:center;">${esc(l.qty)}</td>` +
            `<td style="text-align:center;">${money(l.price_unit)}</td><td style="text-align:left;">${money(l.subtotal_incl)}</td></tr>`).join("");
        const pays = (d.payments || []).map((p) =>
            `<tr><td style="text-align:right;">${esc(p.method)}</td><td style="text-align:left;">${money(p.amount)}</td></tr>`).join("");
        return `<div style="text-align:center;"><h3 style="margin:2px;">${esc(d.company_name)}</h3>` +
            (d.company_street ? `<div>${esc(d.company_street)}</div>` : "") +
            (d.company_phone ? `<div>هاتف: ${esc(d.company_phone)}</div>` : "") +
            (d.company_vat ? `<div>الرقم الضريبي: ${esc(d.company_vat)}</div>` : "") +
            `<div style="font-weight:bold;margin-top:4px;">${d.is_refund ? "إشعار دائن (مرتجع)" : "فاتورة ضريبية مبسطة"}</div></div><hr/>` +
            `<div style="font-size:12px;"><div>الفاتورة: ${esc(d.name)}</div><div>التاريخ: ${esc(d.date)}</div>` +
            `<div>الكاشير: ${esc(d.cashier)}</div>` + (d.partner ? `<div>العميل: ${esc(d.partner)}</div>` : "") + `</div><hr/>` +
            `<table style="width:100%;font-size:12px;"><thead><tr><th style="text-align:right;">الصنف</th><th>كمية</th><th>سعر</th>` +
            `<th style="text-align:left;">إجمالي</th></tr></thead><tbody>${rows}</tbody></table><hr/>` +
            `<div style="font-size:13px;"><div>الإجمالي قبل الضريبة: ${money(d.amount_untaxed)} ${cur}</div>` +
            `<div>ضريبة القيمة المضافة: ${money(d.amount_tax)} ${cur}</div>` +
            `<div style="font-weight:bold;font-size:15px;">الإجمالي: ${money(d.amount_total)} ${cur}</div></div>` +
            (pays ? `<hr/><table style="width:100%;font-size:12px;"><tr><th style="text-align:right;">طريقة الدفع</th>` +
                `<th style="text-align:left;">المبلغ</th></tr>${pays}</table>` : "") +
            `<div style="text-align:center;margin-top:8px;">شكراً لزيارتكم</div>`;
    }
    function zreportHtml(d) {
        const pays = (d.payments || []).map((p) => `<tr><td>${esc(p.name)}</td><td>${money(p.amount)}</td></tr>`).join("");
        return `<h3 style="text-align:center;">تقرير Z</h3><p>الجلسة: ${esc(d.session_name)}</p>` +
            `<p>نقطة البيع: ${esc(d.config_name)}</p><p>المستخدم: ${esc(d.user)}</p><p>البداية: ${esc(d.start)}</p><hr/>` +
            `<p>عدد الفواتير: ${esc(d.order_count)}</p><p>إجمالي المبيعات: ${money(d.total_sales)}</p>` +
            `<p>المرتجعات: ${money(d.total_refunds)}</p><p><b>الصافي: ${money(d.net)}</b></p><hr/>` +
            `<h4>المدفوعات</h4><table>${pays}</table>`;
    }
    function printHtml(html, title) {
        const w = window.open("", "", "height=650,width=420");
        if (!w) {
            return;
        }
        w.document.write(`<html dir="rtl"><head><title>${esc(title || "")}</title><style>` +
            "body{font-family:Tahoma,sans-serif;font-size:13px;}table{width:100%;border-collapse:collapse;}" +
            "td,th{padding:3px;}hr{border:none;border-top:1px dashed #000;}</style></head><body>" +
            html + "</body></html>");
        w.document.close();
        setTimeout(() => w.print(), 300);
    }
    function prescriptionTypes() {
        return [
            ["normal", "عادية"],
            ["controlled", "مخدّرات / مؤثرات عقلية"],
            ["chronic", "أمراض مزمنة"],
        ];
    }


// ==================================================================
// النوافذ المنبثقة
// ==================================================================
export class PharmacyPrescriptionPopup extends AbstractAwaitablePopup {
    static template = "mdev_pharmacy_pos.PrescriptionPopup";
    static defaultProps = { confirmText: _t("تأكيد"), cancelText: _t("إلغاء"), title: _t("وصفة طبية"), productName: "" };
    setup() {
        super.setup();
        this.types = prescriptionTypes();
        this.state = useState({
            patient_name: "", patient_id_number: "", patient_phone: "",
            doctor_name: "", doctor_license: "", prescription_type: "normal", error: false,
        });
    }
    async confirm() {
        if (!this.state.patient_name.trim()) {
            this.state.error = true;
            return;
        }
        return super.confirm();
    }
    getPayload() {
        const s = this.state;
        return {
            patient_name: s.patient_name.trim(),
            patient_id_number: s.patient_id_number,
            patient_phone: s.patient_phone,
            doctor_name: s.doctor_name,
            doctor_license: s.doctor_license,
            prescription_type: s.prescription_type,
        };
    }
}

export class PharmacyOrdersPopup extends AbstractAwaitablePopup {
    static template = "mdev_pharmacy_pos.OrdersPopup";
    static defaultProps = { cancelText: _t("إغلاق"), title: _t("الفواتير السابقة") };
    setup() {
        super.setup();
        this.pos = usePos();
        this.orm = useService("orm");
        this.state = useState({ search: "", orders: [], selected: false });
        onMounted(() => this.load());
    }
    async load() {
        this.state.orders = await this.orm.call("pos.order", "get_previous_orders", [
            this.pos.pos_session.id, 50, this.state.search || "",
        ]);
    }
    money(v) {
        return money(v);
    }
    select(id) {
        this.state.selected = id;
        this.confirm();
    }
    getPayload() {
        return this.state.selected;
    }
}

export class PharmacyPrintPopup extends AbstractAwaitablePopup {
    static template = "mdev_pharmacy_pos.PrintPopup";
    static defaultProps = { cancelText: _t("إغلاق"), title: _t("طباعة"), html: "" };
    get html() {
        return markup(this.props.html || "");
    }
    print() {
        printHtml(this.props.html, this.props.title);
    }
}

// ==================================================================
// تحميل بيانات الصيدلية + منطق إضافة المنتج
// ==================================================================
patch(PosStore.prototype, {
    async after_load_server_data() {
        const data = await this.orm.call("pos.config", "get_pharmacy_pos_data", [[this.config.id]]);
        this.pharmacy = makeState(data);
        return super.after_load_server_data(...arguments);
    },
    async addProductToCurrentOrder(product, options = {}) {
        if (Number.isInteger(product)) {
            product = this.db.get_product_by_id(product);
        }
        const st = this.pharmacy;
        if (!st || !st.cfg.pharmacy_mode) {
            return super.addProductToCurrentOrder(...arguments);
        }
        const flags = flagsOf(st, product.id);
        if (flags.is_pharmaceutical && st.cfg.block_expired && onlyExpired(st, product.id)) {
            await this.popup.add(ErrorPopup, {
                title: _t("دواء منتهي الصلاحية"),
                body: _t('جميع دفعات "%s" منتهية الصلاحية. لا يمكن صرفه.', product.display_name),
            });
            return;
        }
        const order = this.get_order() || this.add_new_order();
        if (st.cfg.enforce_prescription && flags.requires_prescription && !order.get_prescription()) {
            const { confirmed, payload } = await this.popup.add(PharmacyPrescriptionPopup, {
                title: _t("وصفة طبية مطلوبة"),
                productName: product.display_name,
            });
            if (!confirmed) {
                return;
            }
            order.set_prescription(payload);
        }
        const linesBefore = order.get_orderlines().length;
        const res = await super.addProductToCurrentOrder(product, options);
        const line = order.get_selected_orderline();
        if (!line || line.get_product().id !== product.id) {
            return res;
        }
        if (flags.is_controlled) {
            order.has_controlled = true;
        }
        const lot = autoLotFor(st, product);
        if (lot) {
            line.set_lot_info(lot);
            if (st.cfg.warn_near_expiry && lot.expiry_status === "warning") {
                const { confirmed } = await this.popup.add(ConfirmPopup, {
                    title: _t("قارب على الانتهاء"),
                    body: _t("%s - الدفعة %s تنتهي خلال %s يوم.", product.display_name, lot.name, lot.days_remaining),
                });
                if (!confirmed && order.get_orderlines().length > linesBefore) {
                    order.removeOrderline(line);
                }
            }
        }
        return res;
    },
});

// الدفعة تُختار تلقائياً (FEFO)، فلا داعي لنافذة إدخال رقم الدفعة
patch(Product.prototype, {
    async getAddProductOptions(code) {
        const lot = autoLotFor(this.pos.pharmacy, this);
        if (!lot || !["lot", "serial"].includes(this.tracking) || (code && code.type === "lot")) {
            return super.getAddProductOptions(...arguments);
        }
        const tracking = this.tracking;
        this.tracking = "none";
        let options;
        try {
            options = await super.getAddProductOptions(...arguments);
        } finally {
            this.tracking = tracking;
        }
        if (options) {
            options.draftPackLotLines = { modifiedPackLotLines: {}, newPackLotLines: [{ lot_name: lot.name }] };
        }
        return options;
    },
});

// ==================================================================
// الطلب وسطر الطلب
// ==================================================================
function applyPromotions(order) {
    const st = order.pos.pharmacy;
    if (!st || order.is_refund) {
        return;
    }
    for (const line of order.get_orderlines()) {
        if (line.promo_locked || line.get_unit_price() < 0) {
            continue;
        }
        const disc = promoDiscount(st, line.get_product().id, line.get_quantity());
        if (disc > (line.get_discount() || 0)) {
            line.set_discount(disc);
        }
    }
}

patch(Order.prototype, {
    setup() {
        super.setup(...arguments);
        this.prescription = this.prescription || null;
        this.has_controlled = this.has_controlled || false;
    },
    set_prescription(data) {
        this.prescription = data;
    },
    get_prescription() {
        return this.prescription;
    },
    set_loyalty_redeemed(points) {
        this.loyalty_points_redeemed = points;
    },
    async add_product() {
        const res = await super.add_product(...arguments);
        applyPromotions(this);
        return res;
    },
    export_as_JSON() {
        const json = super.export_as_JSON(...arguments);
        json.prescription = this.prescription || false;
        json.has_controlled = this.has_controlled || false;
        json.loyalty_points_redeemed = this.loyalty_points_redeemed || 0;
        json.is_refund = this.is_refund || false;
        json.refunded_order_id = this.refunded_order_id || false;
        return json;
    },
    init_from_JSON(json) {
        super.init_from_JSON(...arguments);
        this.prescription = json.prescription || null;
        this.has_controlled = json.has_controlled || false;
        this.loyalty_points_redeemed = json.loyalty_points_redeemed || 0;
        this.is_refund = json.is_refund || false;
        this.refunded_order_id = json.refunded_order_id || false;
    },
});

patch(Orderline.prototype, {
    set_lot_info(lot) {
        this.lot_name = lot.name;
        this.expiry_date = lot.expiry_date;
    },
    set_quantity() {
        const res = super.set_quantity(...arguments);
        if (this.order) {
            applyPromotions(this.order);
        }
        return res;
    },
    export_as_JSON() {
        const json = super.export_as_JSON(...arguments);
        json.lot_name = this.lot_name || false;
        json.expiry_date = this.expiry_date || false;
        return json;
    },
    init_from_JSON(json) {
        super.init_from_JSON(...arguments);
        this.lot_name = json.lot_name || false;
        this.expiry_date = json.expiry_date || false;
    },
});

// ==================================================================
// منع الدفع إذا كان هناك دواء يتطلب وصفة بدون تسجيلها
// ==================================================================
patch(PaymentScreen.prototype, {
    async validateOrder(isForceValidate) {
        const st = this.pos.pharmacy;
        const order = this.currentOrder;
        if (st && st.cfg.pharmacy_mode && st.cfg.enforce_prescription && !order.is_refund) {
            const needsRx = order.get_orderlines().some((l) => flagsOf(st, l.get_product().id).requires_prescription);
            if (needsRx && !order.get_prescription()) {
                await this.popup.add(ErrorPopup, {
                    title: _t("وصفة مطلوبة"),
                    body: _t("يوجد دواء يتطلب وصفة طبية. سجّل الوصفة أولاً."),
                });
                return;
            }
        }
        return super.validateOrder(...arguments);
    },
});

// ==================================================================
// أزرار شاشة البيع
// ==================================================================
class PharmacyButton extends Component {
    setup() {
        this.pos = usePos();
        this.popup = useService("popup");
        this.orm = useService("orm");
    }
    get order() {
        return this.pos.get_order();
    }
}

export class PharmacyReturnButton extends PharmacyButton {
    static template = "mdev_pharmacy_pos.ReturnButton";
    async onClick() {
        const { confirmed, payload: orderId } = await this.popup.add(PharmacyOrdersPopup, {
            title: _t("اختر فاتورة للمرتجع"),
        });
        if (!confirmed || !orderId) {
            return;
        }
        const data = await this.orm.call("pos.order", "get_order_for_return", [orderId]);
        if (!data || !data.lines) {
            return;
        }
        const pos = this.pos;
        const order = pos.add_new_order();
        order.is_refund = true;
        order.refunded_order_id = data.id;
        if (data.partner_id) {
            const partner = pos.db.get_partner_by_id(data.partner_id);
            if (partner) {
                order.set_partner(partner);
            }
        }
        for (const l of data.lines) {
            const product = pos.db.get_product_by_id(l.product_id);
            if (!product) {
                continue;
            }
            const options = { quantity: -l.qty, price: l.price_unit, merge: false, extras: { price_type: "manual" } };
            if (l.lot_name) {
                options.draftPackLotLines = { modifiedPackLotLines: {}, newPackLotLines: [{ lot_name: l.lot_name }] };
            }
            await order.add_product(product, options);
            const line = order.get_selected_orderline();
            if (line) {
                line.promo_locked = true;
                if (l.discount) {
                    line.set_discount(l.discount);
                }
            }
        }
        await this.popup.add(ConfirmPopup, {
            title: _t("مرتجع"),
            body: _t("تم تحميل الفاتورة %s كمرتجع. أكمل عملية الدفع لإتمام الاسترجاع.", data.name),
        });
    }
}

export class PharmacyReprintButton extends PharmacyButton {
    static template = "mdev_pharmacy_pos.ReprintButton";
    async onClick() {
        const { confirmed, payload: orderId } = await this.popup.add(PharmacyOrdersPopup, {
            title: _t("اختر فاتورة لإعادة الطباعة"),
        });
        if (!confirmed || !orderId) {
            return;
        }
        const data = await this.orm.call("pos.order", "get_receipt_data", [orderId]);
        await this.popup.add(PharmacyPrintPopup, { title: _t("إعادة طباعة"), html: receiptHtml(data) });
    }
}

export class PharmacyZReportButton extends PharmacyButton {
    static template = "mdev_pharmacy_pos.ZReportButton";
    async onClick() {
        const data = await this.orm.call("pos.order", "get_zreport_data", [this.pos.pos_session.id]);
        await this.popup.add(PharmacyPrintPopup, { title: _t("تقرير Z"), html: zreportHtml(data) });
    }
}

export class PharmacyRedeemButton extends PharmacyButton {
    static template = "mdev_pharmacy_pos.RedeemButton";
    async onClick() {
        const st = this.pos.pharmacy;
        const loyalty = st && st.cfg.enable_loyalty && st.loyalty;
        const order = this.order;
        if (!loyalty) {
            return this.popup.add(ErrorPopup, { title: _t("النقاط غير مفعّلة"), body: _t("لم يُعدّ برنامج النقاط.") });
        }
        const partner = order.get_partner();
        if (!partner) {
            return this.popup.add(ErrorPopup, { title: _t("اختر العميل"), body: _t("حدّد العميل أولاً لاستخدام نقاطه.") });
        }
        const points = await this.orm.call("pos.config", "get_partner_loyalty_points", [partner.id]);
        if (points < loyalty.min_redeem_points) {
            return this.popup.add(ErrorPopup, {
                title: _t("نقاط غير كافية"),
                body: _t("رصيد العميل %s نقطة. الحد الأدنى للاستبدال %s نقطة.", points, loyalty.min_redeem_points),
            });
        }
        const total = order.get_total_with_tax();
        const maxValue = Math.min(total * (loyalty.max_redeem_percent / 100), points * loyalty.redeem_value_per_point);
        const { confirmed, payload } = await this.popup.add(NumberPopup, {
            title: _t("قيمة الاستبدال (ريال) - الأقصى %s", money(maxValue)),
            startingValue: Number(money(maxValue)),
        });
        if (!confirmed) {
            return;
        }
        const value = Math.min(parseFloat(payload) || 0, maxValue);
        if (value <= 0) {
            return;
        }
        const pointsUsed = Math.ceil(value / loyalty.redeem_value_per_point);
        order.set_loyalty_redeemed(pointsUsed);
        const pct = Math.min((value / total) * 100, 100);
        for (const l of order.get_orderlines()) {
            l.set_discount(Math.max(l.get_discount() || 0, pct));
        }
        await this.popup.add(ConfirmPopup, {
            title: _t("تم الاستبدال"),
            body: _t("خُصم %s ريال مقابل %s نقطة.", money(value), pointsUsed),
        });
    }
}

const pharmacyOn = function () {
    return this.pos.pharmacy && this.pos.pharmacy.cfg.pharmacy_mode;
};
ProductScreen.addControlButton({ component: PharmacyReturnButton, condition: pharmacyOn });
ProductScreen.addControlButton({ component: PharmacyReprintButton, condition: pharmacyOn });
ProductScreen.addControlButton({ component: PharmacyZReportButton, condition: pharmacyOn });
ProductScreen.addControlButton({
    component: PharmacyRedeemButton,
    condition: function () {
        return pharmacyOn.call(this) && this.pos.pharmacy.cfg.enable_loyalty;
    },
});
