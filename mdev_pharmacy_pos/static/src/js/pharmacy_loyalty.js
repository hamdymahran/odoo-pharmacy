odoo.define('mdev_pharmacy_pos.loyalty', function (require) {
    'use strict';

    var screens = require('point_of_sale.screens');
    var core = require('web.core');
    var _t = core._t;

    // زر استبدال النقاط في شاشة البيع
    var RedeemButton = screens.ActionButtonWidget.extend({
        template: 'PharmacyRedeemButton',
        button_click: function () {
            var self = this;
            var order = this.pos.get_order();
            var config = this.pos.config;
            var loyalty = this.pos.loyalty_config;

            if (!config.enable_loyalty || !loyalty) {
                this.gui.show_popup('error', {
                    title: _t('النقاط غير مفعّلة'),
                    body: _t('لم يُعدّ برنامج النقاط.'),
                });
                return;
            }
            var client = order.get_client();
            if (!client) {
                this.gui.show_popup('error', {
                    title: _t('اختر العميل'),
                    body: _t('حدّد العميل أولاً لاستخدام نقاطه.'),
                });
                return;
            }
            var points = client.loyalty_points || 0;
            if (points < loyalty.min_redeem_points) {
                this.gui.show_popup('error', {
                    title: _t('نقاط غير كافية'),
                    body: _t('رصيد العميل ') + points + _t(' نقطة. الحد الأدنى للاستبدال ') +
                          loyalty.min_redeem_points + _t(' نقطة.'),
                });
                return;
            }

            // أقصى قيمة قابلة للاستبدال
            var order_total = order.get_total_with_tax();
            var max_by_percent = order_total * (loyalty.max_redeem_percent / 100.0);
            var max_by_points = points * loyalty.redeem_value_per_point;
            var max_value = Math.min(max_by_percent, max_by_points);

            this.gui.show_popup('number', {
                title: _t('قيمة الاستبدال (ريال) - الأقصى ') + max_value.toFixed(2),
                value: max_value.toFixed(2),
                confirm: function (val) {
                    var value = Math.min(parseFloat(val) || 0, max_value);
                    if (value <= 0) { return; }
                    var points_used = Math.ceil(value / loyalty.redeem_value_per_point);
                    self._apply_redeem(order, value, points_used);
                },
            });
        },
        _apply_redeem: function (order, value, points_used) {
            // أضف سطر خصم بقيمة سالبة باستخدام منتج الخصم
            var discount_product = this.pos.db.get_product_by_id(
                this.pos.config.discount_product_id &&
                this.pos.config.discount_product_id[0]);
            order.set_loyalty_redeemed(points_used);
            if (discount_product) {
                order.add_product(discount_product, {
                    price: -value,
                    extras: {price_manually_set: true},
                    merge: false,
                });
            } else {
                // بديل: خصم نسبي على الطلب
                var pct = (value / order.get_total_with_tax()) * 100;
                order.get_orderlines().forEach(function (l) {
                    l.set_discount(Math.min(pct, 100));
                });
            }
            this.gui.show_popup('confirm', {
                title: _t('تم الاستبدال'),
                body: _t('خُصم ') + value.toFixed(2) + _t(' ريال مقابل ') +
                      points_used + _t(' نقطة.'),
            });
        },
    });
    screens.define_action_button({name: 'pharmacy_redeem', widget: RedeemButton});
});
