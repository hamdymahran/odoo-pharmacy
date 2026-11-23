# -*- coding: utf-8 -*-
from odoo import models, fields, api, _


class ControlledSubstanceLog(models.Model):
    _name = 'pharmacy.controlled.log'
    _description = 'سجل صرف المواد المخدّرة والمراقَبة'
    _order = 'dispense_date desc, id desc'

    name = fields.Char(
        string='رقم القيد', required=True, copy=False, readonly=True,
        default=lambda self: _('جديد'),
    )
    dispense_date = fields.Datetime(
        string='تاريخ ووقت الصرف', default=fields.Datetime.now, required=True)
    product_id = fields.Many2one('product.product', string='المادة', required=True)
    controlled_category = fields.Selection(
        related='product_id.controlled_category', string='الفئة', store=True)
    quantity = fields.Float(string='الكمية المصروفة', required=True)
    lot_id = fields.Many2one('stock.production.lot', string='الدفعة')

    # الربط التنظيمي
    prescription_id = fields.Many2one('pharmacy.prescription', string='الوصفة')
    patient_name = fields.Char(string='اسم المريض')
    patient_id_number = fields.Char(string='رقم هوية المريض')
    doctor_name = fields.Char(string='الطبيب')

    # المصدر
    pos_order_id = fields.Many2one('pos.order', string='طلب نقطة البيع')
    pharmacist_id = fields.Many2one(
        'res.users', string='الصيدلي', default=lambda self: self.env.user)
    session_id = fields.Many2one('pos.session', string='جلسة نقطة البيع')

    # الرصيد التراكمي (يُحسب تنظيمياً)
    balance_after = fields.Float(string='الرصيد بعد الصرف')
    notes = fields.Text(string='ملاحظات')

    @api.model
    def create(self, vals):
        if vals.get('name', _('جديد')) == _('جديد'):
            vals['name'] = self.env['ir.sequence'].next_by_code(
                'pharmacy.controlled.log') or _('جديد')
        return super(ControlledSubstanceLog, self).create(vals)
