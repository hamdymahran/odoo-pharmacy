# -*- coding: utf-8 -*-
import re
from datetime import date, datetime, timedelta

from odoo import models, fields, api, _
from odoo.exceptions import ValidationError, UserError


class StockProductionLot(models.Model):
    # في أودو 12 اسم النموذج stock.production.lot (في 17+ يصبح stock.lot)
    _inherit = 'stock.production.lot'

    pharma_expiry_date = fields.Date(
        string='تاريخ انتهاء الصلاحية',
        help='تاريخ انتهاء صلاحية الدفعة',
    )
    pharma_manufacture_date = fields.Date(string='تاريخ التصنيع')
    days_remaining = fields.Integer(
        string='الأيام المتبقية',
        compute='_compute_days_remaining',
        store=True,
    )
    expiry_status = fields.Selection([
        ('valid', 'صالح'),
        ('warning', 'قارب الانتهاء'),
        ('expired', 'منتهي'),
        ('none', 'بدون تاريخ'),
    ], string='حالة الصلاحية', compute='_compute_days_remaining', store=True)

    # رصد / GS1
    dtts_serial = fields.Char(string='الرقم التسلسلي (SN)')
    dtts_gtin = fields.Char(string='GTIN', related='product_id.gtin', store=True)
    dtts_state = fields.Selection([
        ('none', 'غير مُدار'),
        ('pending', 'معلّق (بانتظار Accept)'),
        ('active', 'نشط'),
        ('sold', 'مُباع'),
        ('deactivated', 'مُعطّل'),
    ], string='حالة رصد', default='none')

    @api.depends('pharma_expiry_date')
    def _compute_days_remaining(self):
        today = fields.Date.today()
        # عتبة التنبيه من الإعدادات (افتراضياً 90 يوم)
        params = self.env['ir.config_parameter'].sudo()
        if hasattr(params, 'get_int'):  # أودو 20+
            threshold = params.get_int('pharmacy_pos.expiry_warning_days', 90)
        else:
            threshold = int(params.get_param('pharmacy_pos.expiry_warning_days', 90))
        for rec in self:
            if not rec.pharma_expiry_date:
                rec.days_remaining = 0
                rec.expiry_status = 'none'
                continue
            delta = (rec.pharma_expiry_date - today).days
            rec.days_remaining = delta
            if delta < 0:
                rec.expiry_status = 'expired'
            elif delta <= threshold:
                rec.expiry_status = 'warning'
            else:
                rec.expiry_status = 'valid'

    @api.constrains('pharma_expiry_date', 'pharma_manufacture_date')
    def _check_dates(self):
        for rec in self:
            if (rec.pharma_expiry_date and rec.pharma_manufacture_date
                    and rec.pharma_expiry_date <= rec.pharma_manufacture_date):
                raise ValidationError(
                    _('تاريخ انتهاء الصلاحية يجب أن يكون بعد تاريخ التصنيع!'))

    # ------------------------------------------------------------------
    # تحليل كود Datamatrix بمعيار GS1
    # المثال: (01)08691234567890(21)1323424679(17)251231(10)BATCH01
    # ------------------------------------------------------------------
    @api.model
    def parse_datamatrix(self, raw_code):
        result = {}
        ai_patterns = {
            'gtin': r'\(01\)(\d{14})',
            'serial_number': r'\(21\)([^\(]+)',
            'expiry_date': r'\(17\)(\d{6})',
            'batch_number': r'\(10\)([^\(]+)',
        }
        # دعم الصيغة بدون أقواس (FNC1) بشكل مبسّط
        for field_name, pattern in ai_patterns.items():
            match = re.search(pattern, raw_code or '')
            if match:
                result[field_name] = match.group(1).strip()
        if result.get('expiry_date'):
            xd = result['expiry_date']
            try:
                result['expiry_date'] = datetime.strptime('20' + xd, '%Y%m%d').date()
            except ValueError:
                result.pop('expiry_date', None)
        return result
