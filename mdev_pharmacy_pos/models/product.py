# -*- coding: utf-8 -*-
from odoo import models, fields, api, _
from odoo.exceptions import ValidationError


class ProductTemplate(models.Model):
    _inherit = 'product.template'

    # ------------------------------------------------------------------
    # بيانات الدواء الصيدلانية
    # ------------------------------------------------------------------
    is_pharmaceutical = fields.Boolean(
        string='منتج دوائي',
        help='فعّل هذا الخيار للأدوية والمستلزمات الطبية',
    )
    pharma_scientific_name = fields.Char(string='الاسم العلمي / المادة الفعّالة')
    pharma_strength = fields.Char(string='التركيز / الجرعة', help='مثال: 500mg')
    pharma_form = fields.Selection([
        ('tablet', 'أقراص'),
        ('capsule', 'كبسولات'),
        ('syrup', 'شراب'),
        ('injection', 'حقن'),
        ('cream', 'كريم / مرهم'),
        ('drops', 'قطرة'),
        ('inhaler', 'بخاخ'),
        ('suppository', 'لبوس'),
        ('other', 'أخرى'),
    ], string='الشكل الصيدلاني')
    pharma_manufacturer = fields.Char(string='الشركة المصنّعة')
    pharma_country_id = fields.Many2one('res.country', string='بلد المنشأ')

    # الأدوية البديلة (نفس المادة الفعّالة)
    pharma_substitute_ids = fields.Many2many(
        'product.template',
        'product_pharma_substitute_rel',
        'product_id', 'substitute_id',
        string='البدائل الدوائية',
    )

    # ------------------------------------------------------------------
    # التصنيف التنظيمي
    # ------------------------------------------------------------------
    requires_prescription = fields.Boolean(
        string='يتطلب وصفة طبية (Rx)',
        help='لا يمكن صرفه في نقطة البيع بدون تسجيل وصفة طبية',
    )
    is_controlled = fields.Boolean(
        string='مادة مخدّرة / مراقَبة',
        help='يُسجَّل كل صرف منه في سجل المواد المخدّرة',
    )
    controlled_category = fields.Selection([
        ('narcotic', 'مخدّر'),
        ('psychotropic', 'مؤثر عقلي'),
        ('controlled', 'مراقَب'),
    ], string='فئة المراقبة')

    # ------------------------------------------------------------------
    # SFDA / رصد / GS1
    # ------------------------------------------------------------------
    sfda_registration_no = fields.Char(string='رقم تسجيل SFDA')
    sfda_registration_expiry = fields.Date(string='انتهاء تسجيل SFDA')
    gtin = fields.Char(
        string='GTIN (GS1)',
        help='رقم المنتج العالمي - 14 رقم بمعيار GS1، يُستخدم لرصد/DTTS',
    )
    dtts_registered = fields.Boolean(string='مسجَّل في رصد/DTTS')
    track_serial_dtts = fields.Boolean(
        string='تتبّع تسلسلي لرصد',
        help='المنتج يحمل رقم تسلسلي SN فريد لكل عبوة (Datamatrix)',
    )

    @api.constrains('requires_prescription', 'is_controlled')
    def _check_controlled_requires_rx(self):
        for rec in self:
            if rec.is_controlled and not rec.requires_prescription:
                # المواد المخدّرة تتطلب وصفة بالضرورة
                rec.requires_prescription = True

    @api.onchange('is_pharmaceutical')
    def _onchange_is_pharmaceutical(self):
        if self.is_pharmaceutical:
            # الأدوية تتبّع بالدفعات افتراضياً
            self.tracking = 'lot'


class ProductProduct(models.Model):
    _inherit = 'product.product'

    # عكس حقول القالب للراحة في نقطة البيع
    is_pharmaceutical = fields.Boolean(related='product_tmpl_id.is_pharmaceutical', store=True)
    requires_prescription = fields.Boolean(related='product_tmpl_id.requires_prescription', store=True)
    is_controlled = fields.Boolean(related='product_tmpl_id.is_controlled', store=True)
    pharma_scientific_name = fields.Char(related='product_tmpl_id.pharma_scientific_name', store=True)
    gtin = fields.Char(related='product_tmpl_id.gtin', store=True)
