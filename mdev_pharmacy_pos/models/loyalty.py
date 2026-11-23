# -*- coding: utf-8 -*-
from odoo import models, fields, api, _


class PharmacyLoyaltyConfig(models.Model):
    _name = 'pharmacy.loyalty.config'
    _description = 'إعداد برنامج النقاط'

    name = fields.Char(string='اسم البرنامج', required=True, default='برنامج النقاط')
    active = fields.Boolean(default=True)
    earn_points_per_currency = fields.Float(
        string='نقاط لكل 1 ريال', default=1.0,
        help='عدد النقاط المكتسبة عن كل ريال يُنفق',
    )
    redeem_value_per_point = fields.Float(
        string='قيمة النقطة عند الاستبدال (ريال)', default=0.05,
        help='كم ريالاً تساوي النقطة الواحدة عند الاستبدال',
    )
    min_redeem_points = fields.Integer(string='أقل عدد نقاط للاستبدال', default=100)
    max_redeem_percent = fields.Float(
        string='أقصى نسبة خصم بالنقاط %', default=50.0,
        help='أقصى نسبة من قيمة الفاتورة يمكن سدادها بالنقاط',
    )
    exclude_controlled = fields.Boolean(
        string='استثناء المخدّرات من كسب النقاط', default=True)


class ResPartnerLoyalty(models.Model):
    _inherit = 'res.partner'

    loyalty_points = fields.Float(string='رصيد النقاط', default=0.0)
    loyalty_total_earned = fields.Float(string='إجمالي المكتسب', default=0.0)
    loyalty_total_spent = fields.Float(string='إجمالي المستبدَل', default=0.0)

    def add_loyalty_points(self, points):
        for partner in self:
            partner.loyalty_points += points
            if points > 0:
                partner.loyalty_total_earned += points
            else:
                partner.loyalty_total_spent += abs(points)
        return True
