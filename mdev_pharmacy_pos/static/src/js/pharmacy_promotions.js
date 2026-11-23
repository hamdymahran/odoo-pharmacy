odoo.define('mdev_pharmacy_pos.promotions', function (require) {
    'use strict';

    var models = require('point_of_sale.models');

    function best_promo_discount(pos, line) {
        var product = line.get_product();
        if (!product || line.get_unit_price() < 0) { return 0; }
        var promos = pos.promotions || [];
        var qty = line.get_quantity();
        var best = 0;
        promos.forEach(function (p) {
            var match = false;
            if (p.promo_type === 'product_percent') {
                match = p.product_ids.indexOf(product.id) !== -1;
            } else if (p.promo_type === 'category_percent') {
                var categ = product.categ_id ? product.categ_id[0] : false;
                match = categ && p.categ_ids.indexOf(categ) !== -1;
            } else if (p.promo_type === 'qty_discount') {
                match = p.product_ids.indexOf(product.id) !== -1 && qty >= p.min_qty;
            }
            if (match && p.discount_percent > best) {
                best = p.discount_percent;
            }
        });
        return best;
    }

    function apply_promotions(order) {
        var pos = order.pos;
        if (!pos.config.enable_promotions || order.is_refund) { return; }
        order.get_orderlines().forEach(function (line) {
            if (line.promo_locked) { return; }
            var disc = best_promo_discount(pos, line);
            if (disc > (line.get_discount() || 0)) {
                line.set_discount(disc);
                line.promo_applied = true;
            }
        });
    }

    var _super_add = models.Order.prototype.add_product;
    models.Order = models.Order.extend({
        add_product: function (product, options) {
            _super_add.apply(this, arguments);
            apply_promotions(this);
        },
    });

    var _super_setqty = models.Orderline.prototype.set_quantity;
    models.Orderline = models.Orderline.extend({
        set_quantity: function (quantity, keep_price) {
            var res = _super_setqty.apply(this, arguments);
            if (this.order) { apply_promotions(this.order); }
            return res;
        },
    });

    return {apply_promotions: apply_promotions};
});
