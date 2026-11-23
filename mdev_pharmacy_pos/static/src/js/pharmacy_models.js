odoo.define('mdev_pharmacy_pos.models', function (require) {
    'use strict';

    var models = require('point_of_sale.models');

    // إضافة الحقول الصيدلانية لمنتجات نقطة البيع
    models.load_fields('product.product', [
        'is_pharmaceutical', 'requires_prescription', 'is_controlled',
        'gtin', 'track_serial_dtts', 'pharma_scientific_name',
    ]);

    // إضافة إعدادات الصيدلية إلى pos.config
    models.load_fields('pos.config', [
        'pharmacy_mode', 'block_expired', 'warn_near_expiry',
        'expiry_warning_days', 'enforce_prescription',
        'log_controlled', 'dtts_enabled',
        'enable_loyalty', 'enable_promotions',
    ]);

    // رصيد نقاط العميل + فئة المنتج (للعروض)
    models.load_fields('res.partner', ['loyalty_points']);
    models.load_fields('product.product', ['categ_id']);

    // تحميل إعداد برنامج النقاط
    models.load_models({
        model: 'pharmacy.loyalty.config',
        fields: ['name', 'earn_points_per_currency', 'redeem_value_per_point',
                 'min_redeem_points', 'max_redeem_percent', 'exclude_controlled'],
        domain: [['active', '=', true]],
        loaded: function (self, configs) {
            self.loyalty_config = configs.length ? configs[0] : false;
        },
    });

    // تحميل العروض الترويجية السارية
    models.load_models({
        model: 'pharmacy.promotion',
        fields: ['name', 'promo_type', 'discount_percent', 'min_qty',
                 'product_ids', 'categ_ids', 'date_start', 'date_end'],
        domain: [['active', '=', true]],
        loaded: function (self, promos) {
            var today = new Date().toISOString().slice(0, 10);
            self.promotions = promos.filter(function (p) {
                var okStart = !p.date_start || p.date_start <= today;
                var okEnd = !p.date_end || p.date_end >= today;
                return okStart && okEnd;
            });
        },
    });

    // تحميل الدفعات مع الصلاحية إلى الواجهة
    models.load_models({
        model: 'stock.production.lot',
        fields: ['name', 'product_id', 'pharma_expiry_date',
                 'days_remaining', 'expiry_status', 'dtts_serial'],
        domain: [['product_id.is_pharmaceutical', '=', true]],
        loaded: function (self, lots) {
            self.pharmacy_lots_by_product = {};
            lots.forEach(function (lot) {
                var pid = lot.product_id[0];
                if (!self.pharmacy_lots_by_product[pid]) {
                    self.pharmacy_lots_by_product[pid] = [];
                }
                self.pharmacy_lots_by_product[pid].push(lot);
            });
        },
    });

    // مساعد: أفضل دفعة صالحة لمنتج (الأقرب انتهاءً والصالحة) - FEFO
    models.PosModel = models.PosModel || {};
    var _super_posmodel = models.PosModel.prototype;
    models.PosModel = models.PosModel.extend({
        get_product_lots: function (product_id) {
            return (this.pharmacy_lots_by_product || {})[product_id] || [];
        },
        get_best_lot: function (product_id) {
            var lots = this.get_product_lots(product_id).filter(function (l) {
                return l.expiry_status !== 'expired';
            });
            lots.sort(function (a, b) {
                return (a.pharma_expiry_date || '') < (b.pharma_expiry_date || '') ? -1 : 1;
            });
            return lots.length ? lots[0] : false;
        },
        has_only_expired_lots: function (product_id) {
            var lots = this.get_product_lots(product_id);
            if (!lots.length) { return false; }
            return lots.every(function (l) { return l.expiry_status === 'expired'; });
        },
    });

    // بيانات الوصفة على الطلب
    var _super_order = models.Order.prototype;
    models.Order = models.Order.extend({
        initialize: function () {
            _super_order.initialize.apply(this, arguments);
            this.prescription = this.prescription || null;
            this.has_controlled = this.has_controlled || false;
        },
        set_prescription: function (data) {
            this.prescription = data;
            this.trigger('change', this);
        },
        get_prescription: function () {
            return this.prescription;
        },
        export_as_JSON: function () {
            var json = _super_order.export_as_JSON.apply(this, arguments);
            json.prescription = this.prescription || false;
            json.has_controlled = this.has_controlled || false;
            json.loyalty_points_redeemed = this.loyalty_points_redeemed || 0;
            json.is_refund = this.is_refund || false;
            json.refunded_order_id = this.refunded_order_id || false;
            return json;
        },
        init_from_JSON: function (json) {
            _super_order.init_from_JSON.apply(this, arguments);
            this.prescription = json.prescription || null;
            this.has_controlled = json.has_controlled || false;
            this.loyalty_points_redeemed = json.loyalty_points_redeemed || 0;
            this.is_refund = json.is_refund || false;
            this.refunded_order_id = json.refunded_order_id || false;
        },
        set_loyalty_redeemed: function (points) {
            this.loyalty_points_redeemed = points;
            this.trigger('change', this);
        },
    });

    // اسم الدفعة والصلاحية على سطر الطلب
    var _super_line = models.Orderline.prototype;
    models.Orderline = models.Orderline.extend({
        export_as_JSON: function () {
            var json = _super_line.export_as_JSON.apply(this, arguments);
            json.lot_name = this.lot_name || false;
            json.expiry_date = this.expiry_date || false;
            return json;
        },
        init_from_JSON: function (json) {
            _super_line.init_from_JSON.apply(this, arguments);
            this.lot_name = json.lot_name || false;
            this.expiry_date = json.expiry_date || false;
        },
        set_lot_info: function (lot) {
            this.lot_name = lot.name;
            this.expiry_date = lot.pharma_expiry_date;
            // سجّل الدفعة في حقل الدفعات الأصلي في أودو حتى تخرج من المخزون الصحيح
            if (this.has_product_lot && this.pack_lot_lines) {
                this.compute_lot_lines().each(function (pack_lot) {
                    if (!pack_lot.get('lot_name')) {
                        pack_lot.set_lot_name(lot.name);
                    }
                });
            }
        },
    });
});
