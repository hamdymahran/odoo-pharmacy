# -*- coding: utf-8 -*-
from odoo import models, fields, api, _


class PharmacyPrescription(models.Model):
    _name = 'pharmacy.prescription'
    _description = 'وصفة طبية'
    _order = 'create_date desc'
    _rec_name = 'name'

    name = fields.Char(
        string='رقم الوصفة', required=True, copy=False, readonly=True,
        default=lambda self: _('جديد'),
    )
    # بيانات المريض
    patient_name = fields.Char(string='اسم المريض', required=True)
    patient_id_number = fields.Char(string='رقم الهوية / الإقامة')
    patient_phone = fields.Char(string='جوال المريض')
    patient_age = fields.Integer(string='العمر')

    # بيانات الطبيب والجهة
    doctor_name = fields.Char(string='اسم الطبيب')
    doctor_license = fields.Char(string='رقم ترخيص الطبيب')
    clinic_name = fields.Char(string='الجهة / المستشفى')
    prescription_date = fields.Date(string='تاريخ الوصفة', default=fields.Date.today)

    # نوع الوصفة
    prescription_type = fields.Selection([
        ('normal', 'عادية'),
        ('controlled', 'مخدّرات / مؤثرات عقلية'),
        ('chronic', 'أمراض مزمنة'),
    ], string='نوع الوصفة', default='normal')

    line_ids = fields.One2many(
        'pharmacy.prescription.line', 'prescription_id', string='الأصناف')
    partner_id = fields.Many2one('res.partner', string='العميل')

    state = fields.Selection([
        ('draft', 'مسودة'),
        ('dispensed', 'تم الصرف'),
        ('cancelled', 'ملغاة'),
    ], string='الحالة', default='draft')

    pos_order_ids = fields.One2many(
        'pos.order', 'prescription_id', string='طلبات نقطة البيع')
    notes = fields.Text(string='ملاحظات')

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get('name', _('جديد')) == _('جديد'):
                vals['name'] = self.env['ir.sequence'].next_by_code(
                    'pharmacy.prescription') or _('جديد')
        return super(PharmacyPrescription, self).create(vals_list)

    @api.model
    def create_from_ui(self, data):
        """إنشاء وصفة من واجهة نقطة البيع"""
        lines = data.pop('line_ids', [])
        prescription = self.create(data)
        for line in lines:
            line['prescription_id'] = prescription.id
            self.env['pharmacy.prescription.line'].create(line)
        return {'id': prescription.id, 'name': prescription.name}


class PharmacyPrescriptionLine(models.Model):
    _name = 'pharmacy.prescription.line'
    _description = 'سطر وصفة طبية'

    prescription_id = fields.Many2one(
        'pharmacy.prescription', string='الوصفة', required=True, ondelete='cascade')
    product_id = fields.Many2one('product.product', string='الدواء', required=True)
    quantity = fields.Float(string='الكمية', default=1.0)
    dosage = fields.Char(string='الجرعة / طريقة الاستخدام')
    duration = fields.Char(string='مدة العلاج')
