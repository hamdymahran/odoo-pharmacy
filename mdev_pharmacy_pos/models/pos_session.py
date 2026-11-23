# -*- coding: utf-8 -*-
from odoo import models


class PosSession(models.Model):
    _inherit = 'pos.session'

    def _loader_params_product_product(self):
        """إضافة الحقول الصيدلانية لمنتجات نقطة البيع (توافق أودو 12/13)."""
        result = super(PosSession, self)._loader_params_product_product() \
            if hasattr(super(PosSession, self), '_loader_params_product_product') else None
        return result


class PosConfigData(models.Model):
    """تحميل إعدادات الصيدلية وبيانات الدفعات إلى واجهة نقطة البيع."""
    _inherit = 'pos.config'

    def get_pharmacy_lots(self):
        """إرجاع خريطة الدفعات مع الصلاحية للمنتجات الدوائية (تُستدعى من الواجهة)."""
        self.ensure_one()
        lots = self.env['stock.lot'].sudo().search([
            ('product_id.is_pharmaceutical', '=', True),
        ])
        data = {}
        for lot in lots:
            data.setdefault(lot.product_id.id, []).append({
                'id': lot.id,
                'name': lot.name,
                'expiry_date': lot.pharma_expiry_date and
                    lot.pharma_expiry_date.isoformat() or False,
                'days_remaining': lot.days_remaining,
                'expiry_status': lot.expiry_status,
                'serial': lot.dtts_serial or '',
            })
        return data
