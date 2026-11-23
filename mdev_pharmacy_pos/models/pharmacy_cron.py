# -*- coding: utf-8 -*-
from datetime import timedelta

from odoo import models, fields, api


class PharmacyCron(models.AbstractModel):
    _name = 'pharmacy.cron'
    _description = 'مهام الصيدلية المجدوَلة'

    @api.model
    def check_lot_expiry(self):
        """تحديث حالة صلاحية الدفعات يومياً (يُشغّل الحقول المحسوبة)."""
        lots = self.env['stock.production.lot'].search([
            ('pharma_expiry_date', '!=', False),
        ])
        lots._compute_days_remaining()
        return True

    @api.model
    def check_sfda_registration_expiry(self):
        """تنبيه عند قُرب انتهاء تسجيل المنتجات لدى SFDA (90 يوم)."""
        today = fields.Date.today()
        warning_date = today + timedelta(days=90)
        expiring = self.env['product.template'].search([
            ('sfda_registration_expiry', '!=', False),
            ('sfda_registration_expiry', '<=', warning_date),
            ('sfda_registration_expiry', '>=', today),
        ])
        if expiring:
            # يمكن ربطها بقالب بريد لاحقاً
            for product in expiring:
                product.message_post(
                    body='تنبيه: تسجيل SFDA لهذا المنتج يقارب الانتهاء بتاريخ %s'
                    % product.sfda_registration_expiry)
        return True
