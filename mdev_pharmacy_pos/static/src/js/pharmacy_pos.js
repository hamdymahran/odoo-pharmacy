odoo.define('mdev_pharmacy_pos.pos', function (require) {
    'use strict';

    var models = require('point_of_sale.models');
    var screens = require('point_of_sale.screens');
    var PopupWidget = require('point_of_sale.popups');
    var gui = require('point_of_sale.gui');
    var core = require('web.core');
    var _t = core._t;
    var QWeb = core.qweb;

    // ==================================================================
    // منطق الصرف الصيدلاني عند إضافة منتج
    // ==================================================================
    var _super_add_product = models.Order.prototype.add_product;
    models.Order = models.Order.extend({
        add_product: function (product, options) {
            var pos = this.pos;
            var config = pos.config;

            if (config.pharmacy_mode && product.is_pharmaceutical) {
                // 1) منع المنتهي الصلاحية
                if (config.block_expired && pos.has_only_expired_lots(product.id)) {
                    pos.gui.show_popup('error', {
                        title: _t('دواء منتهي الصلاحية'),
                        body: _t('جميع دفعات "') + product.display_name +
                              _t('" منتهية الصلاحية. لا يمكن صرفه.'),
                    });
                    return;
                }
            }

            // أضف المنتج أولاً. إذا وُجدت دفعة صالحة نعيّنها تلقائياً (FEFO)
            // فلا حاجة لنافذة أودو لإدخال رقم الدفعة يدوياً.
            var auto_lot = config.pharmacy_mode && product.is_pharmaceutical &&
                pos.get_best_lot(product.id);
            this._pharma_skip_lot_popup = !!auto_lot;
            try {
                _super_add_product.apply(this, arguments);
            } finally {
                this._pharma_skip_lot_popup = false;
            }
            var line = this.get_selected_orderline();

            if (!(config.pharmacy_mode && product.is_pharmaceutical)) {
                return;
            }

            // 2) تعيين أفضل دفعة (FEFO) وتنبيه قُرب الانتهاء
            var best = pos.get_best_lot(product.id);
            if (best && line) {
                line.set_lot_info(best);
                if (config.warn_near_expiry && best.expiry_status === 'warning') {
                    pos.gui.show_popup('confirm', {
                        title: _t('قارب على الانتهاء'),
                        body: product.display_name + _t(' - الدفعة ') + best.name +
                              _t(' تنتهي خلال ') + best.days_remaining + _t(' يوم.'),
                    });
                }
            }

            // 3) المواد المخدّرة/المراقَبة
            if (product.is_controlled) {
                this.has_controlled = true;
            }

            // 4) فرض الوصفة الطبية
            if (config.enforce_prescription && product.requires_prescription &&
                    !this.get_prescription()) {
                var self = this;
                pos.gui.show_popup('pharmacy_prescription', {
                    title: _t('وصفة طبية مطلوبة'),
                    product_name: product.display_name,
                    confirm: function (presc) {
                        self.set_prescription(presc);
                    },
                    cancel: function () {
                        // إزالة السطر إذا رُفضت الوصفة
                        if (line) { self.remove_orderline(line); }
                    },
                });
            }
        },
    });

    var _super_display_lot_popup = models.Order.prototype.display_lot_popup;
    models.Order = models.Order.extend({
        display_lot_popup: function () {
            if (this._pharma_skip_lot_popup) {
                return;
            }
            return _super_display_lot_popup.apply(this, arguments);
        },
    });

    // ==================================================================
    // منع الدفع إذا كان هناك دواء Rx بدون وصفة
    // ==================================================================
    screens.PaymentScreenWidget.include({
        validate_order: function (force_validation) {
            var order = this.pos.get_order();
            var config = this.pos.config;
            if (config.pharmacy_mode && config.enforce_prescription) {
                var needs_rx = order.get_orderlines().some(function (line) {
                    return line.get_product().requires_prescription;
                });
                if (needs_rx && !order.get_prescription()) {
                    this.gui.show_popup('error', {
                        title: _t('وصفة مطلوبة'),
                        body: _t('يوجد دواء يتطلب وصفة طبية. سجّل الوصفة أولاً.'),
                    });
                    return;
                }
            }
            this._super(force_validation);
        },
    });

    // ==================================================================
    // نافذة إدخال الوصفة الطبية
    // ==================================================================
    var PrescriptionPopup = PopupWidget.extend({
        template: 'PharmacyPrescriptionPopup',
        events: _.extend({}, PopupWidget.prototype.events, {
            'click .button.confirm': 'click_confirm',
            'click .button.cancel': 'click_cancel',
        }),
        show: function (options) {
            options = options || {};
            this._super(options);
            this.options = options;
            this.renderElement();
            this.$('.pharmacy-product').text(options.product_name || '');
        },
        click_confirm: function () {
            var self = this;
            var presc = {
                patient_name: this.$('.rx-patient-name').val(),
                patient_id_number: this.$('.rx-patient-id').val(),
                patient_phone: this.$('.rx-patient-phone').val(),
                doctor_name: this.$('.rx-doctor').val(),
                doctor_license: this.$('.rx-doctor-license').val(),
                prescription_type: this.$('.rx-type').val(),
            };
            if (!presc.patient_name) {
                this.$('.rx-patient-name').css('border-color', 'red');
                return;
            }
            this.gui.close_popup();
            if (this.options.confirm) {
                this.options.confirm.call(this, presc);
            }
        },
        click_cancel: function () {
            this.gui.close_popup();
            if (this.options.cancel) {
                this.options.cancel.call(this);
            }
        },
    });
    gui.define_popup({name: 'pharmacy_prescription', widget: PrescriptionPopup});

    return {PrescriptionPopup: PrescriptionPopup};
});
