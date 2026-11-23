# -*- coding: utf-8 -*-
from odoo import models, fields


class PosConfig(models.Model):
    _inherit = 'pos.config'

    pharmacy_mode = fields.Boolean(
        string='وضع الصيدلية',
        help='تفعيل مزايا الصيدلية في نقطة البيع',
        default=True,
    )
    block_expired = fields.Boolean(
        string='منع بيع المنتهي الصلاحية', default=True,
        help='يمنع صرف الدفعات منتهية الصلاحية نهائياً',
    )
    warn_near_expiry = fields.Boolean(
        string='تنبيه قُرب الانتهاء', default=True,
        help='يُظهر تنبيهاً عند صرف دفعة قاربت الانتهاء',
    )
    expiry_warning_days = fields.Integer(
        string='عتبة التنبيه (أيام)', default=90)
    enforce_prescription = fields.Boolean(
        string='فرض الوصفة للأدوية (Rx)', default=True,
        help='يمنع صرف أي دواء يتطلب وصفة بدون تسجيل الوصفة',
    )
    log_controlled = fields.Boolean(
        string='تسجيل المواد المخدّرة', default=True)
    dtts_enabled = fields.Boolean(
        string='تفعيل رصد/DTTS', default=False,
        help='إرسال عمليات البيع للأدوية المتتبَّعة تسلسلياً إلى رصد',
    )
    enable_loyalty = fields.Boolean(string='تفعيل النقاط', default=True)
    enable_promotions = fields.Boolean(string='تفعيل العروض الترويجية', default=True)
    # ملاحظة: في أودو 12 تُضبط هذه الحقول مباشرة من نموذج نقطة البيع
    # (إعدادات → نقاط البيع → نقطة البيع)، دون الحاجة لـ res.config.settings.
