# -*- coding: utf-8 -*-
from odoo import models, fields, api, _


class PharmacyPromotion(models.Model):
    _name = 'pharmacy.promotion'
    _description = 'عرض ترويجي'
    _order = 'sequence, id'

    name = fields.Char(string='اسم العرض', required=True)
    sequence = fields.Integer(default=10)
    active = fields.Boolean(default=True)
    date_start = fields.Date(string='من تاريخ')
    date_end = fields.Date(string='إلى تاريخ')

    promo_type = fields.Selection([
        ('product_percent', 'خصم % على منتجات'),
        ('category_percent', 'خصم % على فئة'),
        ('qty_discount', 'خصم كمية (اشترِ كمية واحصل على خصم)'),
    ], string='نوع العرض', required=True, default='product_percent')

    discount_percent = fields.Float(string='نسبة الخصم %', default=10.0)
    min_qty = fields.Float(
        string='أقل كمية', default=1.0,
        help='للنوع "خصم كمية": تُطبَّق النسبة عند بلوغ هذه الكمية',
    )
    product_ids = fields.Many2many('product.product', string='المنتجات')
    categ_ids = fields.Many2many('product.category', string='الفئات')

    @api.model
    def get_active_promotions(self):
        """إرجاع العروض السارية لواجهة نقطة البيع."""
        today = fields.Date.today()
        promos = self.search([
            ('active', '=', True),
            '|', ('date_start', '=', False), ('date_start', '<=', today),
            '|', ('date_end', '=', False), ('date_end', '>=', today),
        ])
        result = []
        for p in promos:
            result.append({
                'id': p.id,
                'name': p.name,
                'promo_type': p.promo_type,
                'discount_percent': p.discount_percent,
                'min_qty': p.min_qty,
                'product_ids': p.product_ids.ids,
                'categ_ids': p.categ_ids.ids,
            })
        return result
