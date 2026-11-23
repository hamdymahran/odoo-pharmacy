odoo.define('mdev_pharmacy_pos.sales_ops', function (require) {
    'use strict';

    var screens = require('point_of_sale.screens');
    var models = require('point_of_sale.models');
    var PopupWidget = require('point_of_sale.popups');
    var gui = require('point_of_sale.gui');
    var rpc = require('web.rpc');
    var core = require('web.core');
    var _t = core._t;
    var QWeb = core.qweb;

    // إعادة بناء طلب من بيانات فاتورة سابقة لطباعة نسخة طبق الأصل
    function rebuild_order(pos, data) {
        var order = new models.Order({}, {pos: pos});
        if (data.partner_id) {
            var client = pos.db.get_partner_by_id(data.partner_id);
            if (client) { order.set_client(client); }
        }
        (data.lines || []).forEach(function (l) {
            var product = pos.db.get_product_by_id(l.product_id);
            if (product) {
                order.add_product(product, {
                    quantity: l.qty,
                    price: l.price_unit,
                    discount: l.discount || 0,
                    merge: false,
                    extras: {price_manually_set: true},
                });
            }
        });
        (data.payments || []).forEach(function (p) {
            var reg = _.find(pos.cashregisters || [], function (cr) {
                return cr.journal_id && cr.journal_id[0] === p.journal_id;
            });
            if (reg) {
                order.add_paymentline(reg);
                if (order.selected_paymentline) {
                    order.selected_paymentline.set_amount(p.amount);
                }
            }
        });
        if (data.name) { order.name = data.name; }
        return order;
    }

    // طباعة نسخة طبق الأصل بقالب الإيصال الأصلي PosTicket
    function print_exact_receipt(widget, data) {
        var pos = widget.pos;
        var order = rebuild_order(pos, data);
        var html = QWeb.render('PosTicket', {
            widget: widget,
            pos: pos,
            order: order,
            receipt: order.export_for_printing(),
            orderlines: order.get_orderlines(),
            paymentlines: order.get_paymentlines(),
        });
        var w = window.open('', '', 'height=700,width=360');
        w.document.write('<html><head><title>' + (data.name || '') + '</title>');
        // أنماط إيصال نقطة البيع لتطابق الشكل الأصلي
        w.document.write('<link rel="stylesheet" href="/point_of_sale/static/src/css/pos_receipts.css"/>');
        w.document.write('<style>body{font-family:"Inconsolata",monospace;}' +
            '.pos-receipt{width:300px;margin:0 auto;}</style></head>');
        w.document.write('<body><div class="pos-receipt-print">' + html + '</div></body></html>');
        w.document.close();
        setTimeout(function () { w.print(); }, 400);
    }

    function fetch_previous_orders(pos, search) {
        return rpc.query({
            model: 'pos.order',
            method: 'get_previous_orders',
            args: [pos.pos_session.id, 50, search || ''],
        });
    }

    // ===============================================================
    // نافذة قائمة الفواتير السابقة (تُستخدم للمرتجع وإعادة الطباعة)
    // ===============================================================
    var OrdersPopup = PopupWidget.extend({
        template: 'PharmacyOrdersPopup',
        events: _.extend({}, PopupWidget.prototype.events, {
            'click .order-row': 'click_row',
            'click .search-btn': 'do_search',
            'click .button.cancel': 'click_cancel',
        }),
        show: function (options) {
            this.options = options || {};
            this._super(options);
            this.renderElement();
            this.load_orders('');
        },
        load_orders: function (search) {
            var self = this;
            fetch_previous_orders(this.pos, search).then(function (orders) {
                self.$('.orders-list').empty();
                orders.forEach(function (o) {
                    var row = $('<tr class="order-row" style="cursor:pointer;"></tr>')
                        .attr('data-id', o.id);
                    row.append('<td>' + o.name + '</td>');
                    row.append('<td>' + (o.partner || '-') + '</td>');
                    row.append('<td>' + o.amount_total.toFixed(2) + '</td>');
                    row.append('<td>' + (o.date_order || '') + '</td>');
                    self.$('.orders-list').append(row);
                });
            });
        },
        do_search: function () {
            this.load_orders(this.$('.order-search').val());
        },
        click_row: function (ev) {
            var id = parseInt($(ev.currentTarget).attr('data-id'), 10);
            this.gui.close_popup();
            if (this.options.on_select) { this.options.on_select(id); }
        },
        click_cancel: function () {
            this.gui.close_popup();
        },
    });
    gui.define_popup({name: 'pharmacy_orders', widget: OrdersPopup});

    // ===============================================================
    // نافذة طباعة (مرنة: إيصال أو تقرير Z)
    // ===============================================================
    var PrintPopup = PopupWidget.extend({
        template: 'PharmacyPrintPopup',
        events: _.extend({}, PopupWidget.prototype.events, {
            'click .print-btn': 'do_print',
            'click .button.cancel': 'click_cancel',
        }),
        show: function (options) {
            this.options = options || {};
            this._super(options);
            this.renderElement();
            this.$('.print-content').html(options.html || '');
        },
        do_print: function () {
            var content = this.$('.print-content').html();
            var w = window.open('', '', 'height=600,width=400');
            w.document.write('<html dir="rtl"><head><title>طباعة</title>');
            w.document.write('<style>body{font-family:sans-serif;font-size:13px;}' +
                'table{width:100%;border-collapse:collapse;}td,th{padding:3px;}' +
                'hr{border:none;border-top:1px dashed #000;}</style></head><body>');
            w.document.write(content);
            w.document.write('</body></html>');
            w.document.close();
            w.print();
        },
        click_cancel: function () {
            this.gui.close_popup();
        },
    });
    gui.define_popup({name: 'pharmacy_print', widget: PrintPopup});

    function render_receipt_html(data) {
        var cur = data.currency || 'ريال';
        var rows = (data.lines || []).map(function (l) {
            return '<tr><td style="text-align:right;">' + l.product +
                '</td><td style="text-align:center;">' + l.qty +
                '</td><td style="text-align:center;">' + l.price_unit.toFixed(2) +
                '</td><td style="text-align:left;">' + l.subtotal_incl.toFixed(2) +
                '</td></tr>';
        }).join('');
        var pays = (data.payments || []).map(function (p) {
            return '<tr><td style="text-align:right;">' + p.method +
                '</td><td style="text-align:left;">' + p.amount.toFixed(2) + '</td></tr>';
        }).join('');
        var head = '<div style="text-align:center;">' +
            '<h3 style="margin:2px;">' + (data.company_name || '') + '</h3>' +
            (data.company_street ? '<div>' + data.company_street + '</div>' : '') +
            (data.company_phone ? '<div>هاتف: ' + data.company_phone + '</div>' : '') +
            (data.company_vat ? '<div>الرقم الضريبي: ' + data.company_vat + '</div>' : '') +
            '<div style="font-weight:bold;margin-top:4px;">' +
            (data.is_refund ? 'إشعار دائن (مرتجع)' : 'فاتورة ضريبية مبسطة') + '</div>' +
            '</div><hr/>';
        var meta = '<div style="font-size:12px;">' +
            '<div>الفاتورة: ' + data.name + '</div>' +
            '<div>التاريخ: ' + (data.date || '') + '</div>' +
            '<div>الكاشير: ' + (data.cashier || '') + '</div>' +
            (data.partner ? '<div>العميل: ' + data.partner + '</div>' : '') +
            '</div><hr/>';
        var table = '<table style="width:100%;font-size:12px;"><thead>' +
            '<tr><th style="text-align:right;">الصنف</th><th>كمية</th><th>سعر</th><th style="text-align:left;">إجمالي</th></tr>' +
            '</thead><tbody>' + rows + '</tbody></table><hr/>';
        var totals = '<div style="font-size:13px;">' +
            '<div>الإجمالي قبل الضريبة: ' + data.amount_untaxed.toFixed(2) + ' ' + cur + '</div>' +
            '<div>ضريبة القيمة المضافة: ' + data.amount_tax.toFixed(2) + ' ' + cur + '</div>' +
            '<div style="font-weight:bold;font-size:15px;">الإجمالي: ' + data.amount_total.toFixed(2) + ' ' + cur + '</div>' +
            '</div>';
        var payblock = pays ? '<hr/><table style="width:100%;font-size:12px;">' +
            '<tr><th style="text-align:right;">طريقة الدفع</th><th style="text-align:left;">المبلغ</th></tr>' +
            pays + '</table>' : '';
        var qr = data.zatca_qr ? '<div style="text-align:center;margin-top:6px;font-size:10px;">' +
            'ZATCA QR: ' + data.zatca_qr + '</div>' : '';
        return head + meta + table + totals + payblock + qr +
            '<div style="text-align:center;margin-top:8px;">شكراً لزيارتكم</div>';
    }

    function render_zreport_html(d) {
        var pays = (d.payments || []).map(function (p) {
            return '<tr><td>' + p.name + '</td><td>' + p.amount.toFixed(2) + '</td></tr>';
        }).join('');
        return '<h3 style="text-align:center;">تقرير Z</h3>' +
            '<p>الجلسة: ' + d.session_name + '</p>' +
            '<p>نقطة البيع: ' + d.config_name + '</p>' +
            '<p>المستخدم: ' + d.user + '</p>' +
            '<p>البداية: ' + (d.start || '') + '</p><hr/>' +
            '<p>عدد الفواتير: ' + d.order_count + '</p>' +
            '<p>إجمالي المبيعات: ' + d.total_sales.toFixed(2) + '</p>' +
            '<p>المرتجعات: ' + d.total_refunds.toFixed(2) + '</p>' +
            '<p><b>الصافي: ' + d.net.toFixed(2) + ' ريال</b></p><hr/>' +
            '<h4>المدفوعات</h4><table>' + pays + '</table>';
    }

    // ===============================================================
    // زر المرتجع
    // ===============================================================
    var ReturnButton = screens.ActionButtonWidget.extend({
        template: 'PharmacyReturnButton',
        button_click: function () {
            var self = this;
            this.gui.show_popup('pharmacy_orders', {
                title: _t('اختر فاتورة للمرتجع'),
                on_select: function (order_id) { self._do_return(order_id); },
            });
        },
        _do_return: function (order_id) {
            var self = this;
            rpc.query({
                model: 'pos.order', method: 'get_order_for_return', args: [order_id],
            }).then(function (data) {
                if (!data || !data.lines) { return; }
                self.pos.add_new_order();
                var order = self.pos.get_order();
                order.is_refund = true;
                order.refunded_order_id = data.id;
                if (data.partner_id) {
                    var client = self.pos.db.get_partner_by_id(data.partner_id);
                    if (client) { order.set_client(client); }
                }
                data.lines.forEach(function (l) {
                    var product = self.pos.db.get_product_by_id(l.product_id);
                    if (product) {
                        order.add_product(product, {
                            quantity: -l.qty,
                            price: l.price_unit,
                            extras: {price_manually_set: true},
                        });
                        var line = order.get_selected_orderline();
                        if (line && l.discount) { line.set_discount(l.discount); }
                        if (line) { line.promo_locked = true; }
                    }
                });
                self.gui.show_screen('products');
                self.gui.show_popup('confirm', {
                    title: _t('مرتجع'),
                    body: _t('تم تحميل الفاتورة ') + data.name +
                          _t(' كمرتجع. أكمل عملية الدفع لإتمام الاسترجاع.'),
                });
            });
        },
    });
    screens.define_action_button({name: 'pharmacy_return', widget: ReturnButton});

    // ===============================================================
    // زر إعادة طباعة فاتورة سابقة
    // ===============================================================
    var ReprintButton = screens.ActionButtonWidget.extend({
        template: 'PharmacyReprintButton',
        button_click: function () {
            var self = this;
            this.gui.show_popup('pharmacy_orders', {
                title: _t('اختر فاتورة لإعادة الطباعة'),
                on_select: function (order_id) {
                    rpc.query({
                        model: 'pos.order', method: 'get_receipt_data',
                        args: [order_id],
                    }).then(function (data) {
                        try {
                            // نسخة طبق الأصل بقالب الإيصال الأصلي
                            print_exact_receipt(self, data);
                        } catch (e) {
                            // بديل آمن: معاينة منسّقة داخل نافذة
                            console.error('reprint exact failed, fallback', e);
                            self.gui.show_popup('pharmacy_print', {
                                title: _t('إعادة طباعة'),
                                html: render_receipt_html(data),
                            });
                        }
                    });
                },
            });
        },
    });
    screens.define_action_button({name: 'pharmacy_reprint', widget: ReprintButton});

    // ===============================================================
    // زر تقرير Z
    // ===============================================================
    var ZReportButton = screens.ActionButtonWidget.extend({
        template: 'PharmacyZReportButton',
        button_click: function () {
            var self = this;
            rpc.query({
                model: 'pos.order', method: 'get_zreport_data',
                args: [this.pos.pos_session.id],
            }).then(function (data) {
                self.gui.show_popup('pharmacy_print', {
                    title: _t('تقرير Z'),
                    html: render_zreport_html(data),
                });
            });
        },
    });
    screens.define_action_button({name: 'pharmacy_zreport', widget: ZReportButton});
});
