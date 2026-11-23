/** @odoo-module */
/*
 * Pharmacy POS — Odoo 19 point-of-sale interface
 * Author: Hamdy Mahran
 */

import { _t } from "@web/core/l10n/translation";
import { patch } from "@web/core/utils/patch";
import { Component, useState, onMounted, markup } from "@odoo/owl";
import { Dialog } from "@web/core/dialog/dialog";
import { AlertDialog, ConfirmationDialog } from "@web/core/confirmation_dialog/confirmation_dialog";
import { PosStore } from "@point_of_sale/app/services/pos_store";
import { usePos } from "@point_of_sale/app/hooks/pos_hook";
import { makeAwaitable } from "@point_of_sale/app/utils/make_awaitable_dialog";
import { PosOrder } from "@point_of_sale/app/models/pos_order";
import { PosOrderline } from "@point_of_sale/app/models/pos_order_line";
import { PaymentScreen } from "@point_of_sale/app/screens/payment_screen/payment_screen";
import { ControlButtons } from "@point_of_sale/app/screens/product_screen/control_buttons/control_buttons";
import { NumberPopup } from "@point_of_sale/app/components/popups/number_popup/number_popup";

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


// طبقة توافق لأودو 18 و19 و20: تجرّب اسم الدالة الجديد ثم القديم
function callFirst(obj, names, ...args) {
    for (const name of names) {
        if (obj && typeof obj[name] === "function") {
            return obj[name](...args);
        }
    }
    return undefined;
}
const P = {
    getOrder: (pos) => callFirst(pos, ["getOrder", "get_order"]),
    newOrder: (pos) => callFirst(pos, ["addNewOrder", "add_new_order"]),
    select: (pos, o) => callFirst(pos, ["setOrder", "set_order"], o),
    lines: (o) => callFirst(o, ["getOrderlines", "get_orderlines"]) || o.lines || [],
    removeLine: (o, l) => callFirst(o, ["removeOrderline"], l),
    unitPrice: (l) => l.price_unit,
    qty: (l) => l.qty,
    discount: (l) => l.discount || 0,
    setDiscount: (l, d) => callFirst(l, ["setDiscount", "set_discount"], d),
    setPartner: (o, p) => callFirst(o, ["setPartner", "set_partner"], p),
    partner: (o) => callFirst(o, ["getPartner", "get_partner"]) || o.partner_id,
    totalWithTax: (o) => {
        const v = callFirst(o, ["getTotalWithTax", "get_total_with_tax"]);
        if (typeof v === "number") {
            return v;
        }
        if (typeof o.priceIncl === "number") {
            return o.priceIncl;
        }
        return o.amount_total || 0;
    },
    // المنتج (product.product) من قيم السطر: أودو 18 يمرّر product_id، و19/20 يمرّران القالب
    product: (pos, vals) => {
        if (!vals) {
            return null;
        }
        if (vals.product_id && typeof vals.product_id === "object") {
            return vals.product_id;
        }
        if (typeof vals.product_id === "number") {
            return pos.models["product.product"].get(vals.product_id);
        }
        let tmpl = vals.product_tmpl_id;
        if (typeof tmpl === "number") {
            tmpl = pos.models["product.template"].get(tmpl);
        }
        const variants = (tmpl && tmpl.product_variant_ids) || [];
        return variants.length === 1 ? variants[0] : null;
    },
};


let PHARMACY_STATE = null;

function alertDialog(dialog, title, body) {
    return new Promise((resolve) => dialog.add(AlertDialog, { title, body }, { onClose: () => resolve() }));
}
function confirmDialog(dialog, title, body) {
    return new Promise((resolve) => {
        dialog.add(
            ConfirmationDialog,
            { title, body, confirm: () => resolve(true), cancel: () => resolve(false) },
            { onClose: () => resolve(false) }
        );
    });
}

// ==================================================================
// النوافذ
// ==================================================================
export class PharmacyPrescriptionDialog extends Component {
    static template = "mdev_pharmacy_pos.PrescriptionDialog";
    static components = { Dialog };
    static props = { title: { type: String, optional: true }, productName: { type: String, optional: true }, getPayload: Function, close: Function };
    setup() {
        this.types = prescriptionTypes();
        this.state = useState({
            patient_name: "", patient_id_number: "", patient_phone: "",
            doctor_name: "", doctor_license: "", prescription_type: "normal", error: false,
        });
    }
    confirm() {
        const s = this.state;
        if (!s.patient_name.trim()) {
            s.error = true;
            return;
        }
        this.props.getPayload({
            patient_name: s.patient_name.trim(),
            patient_id_number: s.patient_id_number,
            patient_phone: s.patient_phone,
            doctor_name: s.doctor_name,
            doctor_license: s.doctor_license,
            prescription_type: s.prescription_type,
        });
        this.props.close();
    }
}

export class PharmacyOrdersDialog extends Component {
    static template = "mdev_pharmacy_pos.OrdersDialog";
    static components = { Dialog };
    static props = { title: { type: String, optional: true }, getPayload: Function, close: Function };
    setup() {
        this.pos = usePos();
        this.state = useState({ search: "", orders: [] });
        onMounted(() => this.load());
    }
    async load() {
        this.state.orders = await this.pos.data.call("pos.order", "get_previous_orders", [
            this.pos.session.id, 50, this.state.search || "",
        ]);
    }
    money(v) {
        return money(v);
    }
    select(id) {
        this.props.getPayload(id);
        this.props.close();
    }
}

export class PharmacyPrintDialog extends Component {
    static template = "mdev_pharmacy_pos.PrintDialog";
    static components = { Dialog };
    static props = { title: { type: String, optional: true }, html: { type: String, optional: true }, close: Function, getPayload: { type: Function, optional: true } };
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
    async afterProcessServerData() {
        try {
            const data = await this.data.call("pos.config", "get_pharmacy_pos_data", [[this.config.id]]);
            this.pharmacy = makeState(data);
            PHARMACY_STATE = this.pharmacy;
        } catch (e) {
            console.error("Pharmacy POS: could not load pharmacy data", e);
            this.pharmacy = makeState({});
        }
        return super.afterProcessServerData(...arguments);
    },
    async editLots(product, packLotLinesToEdit) {
        // الدفعة تُختار تلقائياً (FEFO)، فلا داعي لنافذة إدخال رقم الدفعة
        const lot = autoLotFor(this.pharmacy, product);
        if (lot && !(packLotLinesToEdit && packLotLinesToEdit.length)) {
            return { modifiedPackLotLines: {}, newPackLotLines: [{ lot_name: lot.name }] };
        }
        return super.editLots(...arguments);
    },
    async addLineToCurrentOrder(vals, opts = {}, configure = true) {
        const st = this.pharmacy;
        const product = P.product(this, vals);
        if (!st || !st.cfg.pharmacy_mode || !product) {
            return super.addLineToCurrentOrder(...arguments);
        }
        const flags = flagsOf(st, product.id);
        if (flags.is_pharmaceutical && st.cfg.block_expired && onlyExpired(st, product.id)) {
            await alertDialog(this.dialog, _t("دواء منتهي الصلاحية"),
                _t('جميع دفعات "%s" منتهية الصلاحية. لا يمكن صرفه.', product.display_name));
            return;
        }
        const order = P.getOrder(this) || P.newOrder(this);
        if (st.cfg.enforce_prescription && flags.requires_prescription && !order.pharmacy_prescription_json) {
            const payload = await makeAwaitable(this.dialog, PharmacyPrescriptionDialog, {
                title: _t("وصفة طبية مطلوبة"),
                productName: product.display_name,
            });
            if (!payload) {
                return;
            }
            order.pharmacy_prescription_json = JSON.stringify(payload);
        }
        const linesBefore = P.lines(order).length;
        const line = await super.addLineToCurrentOrder(...arguments);
        if (!line) {
            return line;
        }
        if (flags.is_controlled) {
            order.has_controlled = true;
        }
        const lot = autoLotFor(st, product);
        if (lot) {
            line.lot_name = lot.name;
            line.expiry_date = lot.expiry_date;
            if (st.cfg.warn_near_expiry && lot.expiry_status === "warning") {
                const ok = await confirmDialog(this.dialog, _t("قارب على الانتهاء"),
                    _t("%s - الدفعة %s تنتهي خلال %s يوم.", product.display_name, lot.name, lot.days_remaining));
                if (!ok && P.lines(order).length > linesBefore) {
                    P.removeLine(order, line);
                    return;
                }
            }
        }
        applyPromotions(order, st);
        return line;
    },
});

function applyPromotions(order, st) {
    if (!st || order.is_refund) {
        return;
    }
    for (const line of P.lines(order)) {
        if (line.promo_locked || P.unitPrice(line) < 0) {
            continue;
        }
        const disc = promoDiscount(st, line.product_id.id, P.qty(line));
        if (disc > (P.discount(line) || 0)) {
            P.setDiscount(line, disc);
        }
    }
}

patch(PosOrderline.prototype, {
    setQuantity(...args) {
        const res = super.setQuantity(...args);
        if (PHARMACY_STATE && this.order_id) {
            applyPromotions(this.order_id, PHARMACY_STATE);
        }
        return res;
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
            const needsRx = P.lines(order).some((l) => flagsOf(st, l.product_id.id).requires_prescription);
            if (needsRx && !order.pharmacy_prescription_json) {
                await alertDialog(this.dialog, _t("وصفة مطلوبة"), _t("يوجد دواء يتطلب وصفة طبية. سجّل الوصفة أولاً."));
                return;
            }
        }
        return super.validateOrder(...arguments);
    },
});

// ==================================================================
// أزرار شاشة البيع (داخل قائمة "المزيد")
// ==================================================================
patch(ControlButtons.prototype, {
    get pharmacyOn() {
        return Boolean(this.pos.pharmacy && this.pos.pharmacy.cfg.pharmacy_mode);
    },
    get pharmacyLoyaltyOn() {
        return this.pharmacyOn && Boolean(this.pos.pharmacy.cfg.enable_loyalty);
    },
    async pharmacyPickOrder(title) {
        return makeAwaitable(this.dialog, PharmacyOrdersDialog, { title });
    },
    async pharmacyReturn() {
        const orderId = await this.pharmacyPickOrder(_t("اختر فاتورة للمرتجع"));
        if (!orderId) {
            return;
        }
        const pos = this.pos;
        const data = await pos.data.call("pos.order", "get_order_for_return", [orderId]);
        if (!data || !data.lines) {
            return;
        }
        const order = P.newOrder(pos);
        P.select(pos, order);
        order.is_refund = true;
        order.refunded_order_id = data.id;
        if (data.partner_id) {
            const partner = pos.models["res.partner"].get(data.partner_id);
            if (partner) {
                P.setPartner(order, partner);
            }
        }
        for (const l of data.lines) {
            const product = pos.models["product.product"].get(l.product_id);
            if (!product) {
                continue;
            }
            const line = await pos.addLineToOrder(
                { product_id: product, product_tmpl_id: product.product_tmpl_id, qty: -l.qty, price_unit: l.price_unit, discount: l.discount || 0, price_type: "manual" },
                order, {}, false
            );
            if (line) {
                line.promo_locked = true;
                if (l.lot_name && line.setPackLotLines) {
                    line.setPackLotLines({ modifiedPackLotLines: {}, newPackLotLines: [{ lot_name: l.lot_name }], setQuantity: false });
                }
            }
        }
        await alertDialog(this.dialog, _t("مرتجع"),
            _t("تم تحميل الفاتورة %s كمرتجع. أكمل عملية الدفع لإتمام الاسترجاع.", data.name));
    },
    async pharmacyReprint() {
        const orderId = await this.pharmacyPickOrder(_t("اختر فاتورة لإعادة الطباعة"));
        if (!orderId) {
            return;
        }
        const data = await this.pos.data.call("pos.order", "get_receipt_data", [orderId]);
        this.dialog.add(PharmacyPrintDialog, { title: _t("إعادة طباعة"), html: receiptHtml(data) });
    },
    async pharmacyZReport() {
        const data = await this.pos.data.call("pos.order", "get_zreport_data", [this.pos.session.id]);
        this.dialog.add(PharmacyPrintDialog, { title: _t("تقرير Z"), html: zreportHtml(data) });
    },
    async pharmacyRedeem() {
        const pos = this.pos;
        const st = pos.pharmacy;
        const loyalty = st && st.cfg.enable_loyalty && st.loyalty;
        const order = P.getOrder(pos);
        if (!loyalty) {
            return alertDialog(this.dialog, _t("النقاط غير مفعّلة"), _t("لم يُعدّ برنامج النقاط."));
        }
        const partner = P.partner(order);
        if (!partner) {
            return alertDialog(this.dialog, _t("اختر العميل"), _t("حدّد العميل أولاً لاستخدام نقاطه."));
        }
        const points = await pos.data.call("pos.config", "get_partner_loyalty_points", [partner.id]);
        if (points < loyalty.min_redeem_points) {
            return alertDialog(this.dialog, _t("نقاط غير كافية"),
                _t("رصيد العميل %s نقطة. الحد الأدنى للاستبدال %s نقطة.", points, loyalty.min_redeem_points));
        }
        const total = P.totalWithTax(order);
        const maxValue = Math.min(total * (loyalty.max_redeem_percent / 100), points * loyalty.redeem_value_per_point);
        const payload = await makeAwaitable(this.dialog, NumberPopup, {
            title: _t("قيمة الاستبدال (ريال) - الأقصى %s", money(maxValue)),
            startingValue: money(maxValue),
        });
        if (payload === undefined || payload === null) {
            return;
        }
        const value = Math.min(parseFloat(payload) || 0, maxValue);
        if (value <= 0) {
            return;
        }
        const pointsUsed = Math.ceil(value / loyalty.redeem_value_per_point);
        order.loyalty_points_redeemed = pointsUsed;
        const pct = Math.min((value / total) * 100, 100);
        for (const l of P.lines(order)) {
            P.setDiscount(l, Math.max(P.discount(l) || 0, pct));
        }
        await alertDialog(this.dialog, _t("تم الاستبدال"), _t("خُصم %s ريال مقابل %s نقطة.", money(value), pointsUsed));
    },
});
