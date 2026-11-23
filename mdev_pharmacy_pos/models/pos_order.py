# -*- coding: utf-8 -*-
import json
import logging

from odoo import models, fields, api, _

_logger = logging.getLogger(__name__)


class PosOrder(models.Model):
    _inherit = 'pos.order'

    prescription_id = fields.Many2one('pharmacy.prescription', string='الوصفة الطبية')
    has_controlled = fields.Boolean(string='يحوي مواد مخدّرة')
    controlled_log_ids = fields.One2many(
        'pharmacy.controlled.log', 'pos_order_id', string='قيود المخدّرات')

    # حقول ZATCA الأساسية على مستوى الطلب
    zatca_qr = fields.Text(string='رمز QR (ZATCA)')
    zatca_uuid = fields.Char(string='UUID الفاتورة')

    # النقاط
    loyalty_points_earned = fields.Float(string='نقاط مكتسبة')
    loyalty_points_redeemed = fields.Float(string='نقاط مستبدَلة')

    # بيانات الوصفة القادمة من الواجهة (تُستخدم من أودو 18)
    pharmacy_prescription_json = fields.Text(string='بيانات الوصفة (من نقطة البيع)', copy=False)
    # يمنع تكرار المعالجة الصيدلانية إذا وصل الطلب للخادم أكثر من مرة
    pharmacy_processed = fields.Boolean(string='تمت المعالجة الصيدلانية', copy=False)

    # المرتجع
    is_refund = fields.Boolean(string='مرتجع')
    refunded_order_id = fields.Many2one('pos.order', string='الفاتورة الأصلية')

    # ------------------------------------------------------------------
    # استخراج الحقول الإضافية القادمة من واجهة نقطة البيع
    # ------------------------------------------------------------------
    def _order_fields(self, ui_order):
        fields_return = super(PosOrder, self)._order_fields(ui_order)
        fields_return['has_controlled'] = ui_order.get('has_controlled', False)
        fields_return['loyalty_points_redeemed'] = ui_order.get('loyalty_points_redeemed', 0.0)
        fields_return['is_refund'] = ui_order.get('is_refund', False)
        fields_return['refunded_order_id'] = ui_order.get('refunded_order_id', False)
        return fields_return

    def _process_order(self, order, *args):
        """أودو 13: _process_order(order, draft, existing_order)."""
        order_id = super(PosOrder, self)._process_order(order, *args)
        pos_order = self.browse(order_id) if isinstance(order_id, int) else order_id
        try:
            # من أودو 13: بيانات الطلب داخل المفتاح 'data'
            ui_order = order.get('data', order) if isinstance(order, dict) else order
            # صلاحيات النظام: الكاشير قد لا يملك صلاحية إنشاء الوصفات وسجل المخدّرات
            pos_order.sudo()._pharmacy_post_process(ui_order)
        except Exception:
            _logger.exception('خطأ في المعالجة الصيدلانية بعد الطلب')
        return order_id

    def _pharmacy_post_process(self, ui_order):
        """المعالجة الصيدلانية: الوصفة، سجل المخدّرات، رصد."""
        self.ensure_one()
        if self.pharmacy_processed:
            return
        config = self.session_id.config_id

        # 1) ربط الوصفة الطبية إن وُجدت
        presc_data = ui_order.get('prescription')
        if not presc_data and self.pharmacy_prescription_json:
            try:
                presc_data = json.loads(self.pharmacy_prescription_json)
            except ValueError:
                presc_data = False
        if presc_data and not self.prescription_id:
            if presc_data.get('id'):
                self.prescription_id = presc_data['id']
            else:
                presc = self.env['pharmacy.prescription'].create_from_ui(presc_data)
                self.prescription_id = presc['id']
            if self.prescription_id:
                self.prescription_id.write({'state': 'dispensed'})

        # 2) سجل المواد المخدّرة + 3) رصد
        for line in self.lines:
            product = line.product_id
            # سجل المخدّرات
            if config.log_controlled and product.is_controlled:
                self.env['pharmacy.controlled.log'].create({
                    'product_id': product.id,
                    'quantity': line.qty,
                    'prescription_id': self.prescription_id.id or False,
                    'patient_name': self.prescription_id.patient_name or '',
                    'patient_id_number': self.prescription_id.patient_id_number or '',
                    'doctor_name': self.prescription_id.doctor_name or '',
                    'pos_order_id': self.id,
                    'session_id': self.session_id.id,
                    'pharmacist_id': self.user_id.id or self.env.uid,
                })
                self.has_controlled = True

            # رصد/DTTS لبيع الأدوية المتتبَّعة تسلسلياً
            if config.dtts_enabled and product.track_serial_dtts and product.gtin:
                serial = line._get_dtts_serial()
                if serial:
                    self.env['dtts.service'].pharmacy_sale(
                        gtin=product.gtin, serial_no=serial,
                        pos_order_id=self.id)

        # النقاط: الكسب والاستبدال
        if config.enable_loyalty and self.partner_id:
            self._process_loyalty(config)

        self.pharmacy_processed = True

    def _process_loyalty(self, config):
        self.ensure_one()
        loyalty = self.env['pharmacy.loyalty.config'].search(
            [('active', '=', True)], limit=1)
        if not loyalty:
            return
        # استبدال النقاط (أُرسل من الواجهة كخصم)
        if self.loyalty_points_redeemed:
            self.partner_id.add_loyalty_points(-abs(self.loyalty_points_redeemed))
        # كسب النقاط (لا كسب على المرتجعات)
        if not self.is_refund and self.amount_total > 0:
            base = self.amount_total
            if loyalty.exclude_controlled:
                controlled_amount = sum(
                    l.price_subtotal_incl for l in self.lines
                    if l.product_id.is_controlled)
                base = max(base - controlled_amount, 0)
            earned = round(base * loyalty.earn_points_per_currency, 2)
            if earned > 0:
                self.loyalty_points_earned = earned
                self.partner_id.add_loyalty_points(earned)

    # ------------------------------------------------------------------
    # دوال تخدم واجهة نقطة البيع: الفواتير السابقة، المرتجع، تقرير Z
    # ------------------------------------------------------------------
    @api.model
    def get_previous_orders(self, session_id=False, limit=50, search=''):
        domain = [('state', 'in', ['paid', 'done', 'invoiced'])]
        if session_id:
            domain.append(('session_id', '=', session_id))
        if search:
            domain += ['|', ('name', 'ilike', search), ('pos_reference', 'ilike', search)]
        orders = self.search(domain, limit=limit, order='date_order desc')
        return [{
            'id': o.id,
            'name': o.name,
            'pos_reference': o.pos_reference or '',
            'date_order': fields.Datetime.to_string(o.date_order),
            'partner': o.partner_id.name or '',
            'amount_total': o.amount_total,
            'is_refund': o.is_refund,
        } for o in orders]

    @api.model
    def get_order_for_return(self, order_id):
        """إرجاع أسطر فاتورة سابقة لتحميلها كمرتجع في نقطة البيع."""
        order = self.browse(order_id)
        if not order.exists():
            return {}
        return {
            'id': order.id,
            'name': order.name,
            'partner_id': order.partner_id.id or False,
            'lines': [{
                'product_id': l.product_id.id,
                'product_name': l.product_id.display_name,
                'qty': l.qty,
                'price_unit': l.price_unit,
                'discount': l.discount,
            } for l in order.lines],
        }

    @api.model
    def get_receipt_data(self, order_id):
        """بيانات الفاتورة الكاملة لإعادة طباعتها بنفس شكل الإيصال الأصلي."""
        order = self.browse(order_id)
        if not order.exists():
            return {}
        company = order.company_id or self.env.user.company_id
        currency = getattr(order, 'currency_id', False) or order.pricelist_id.currency_id
        return {
            'id': order.id,
            'name': order.name,
            'pos_reference': order.pos_reference or '',
            'partner_id': order.partner_id.id or False,
            'date': fields.Datetime.to_string(order.date_order),
            'cashier': order.user_id.name or '',
            'partner': order.partner_id.name or '',
            'company_name': company.name or '',
            'company_vat': company.vat or '',
            'company_phone': company.phone or '',
            'company_street': company.street or '',
            'currency': currency.symbol or 'ريال',
            'is_refund': order.is_refund,
            'lines': [{
                'product_id': l.product_id.id,
                'product': l.product_id.display_name,
                'qty': l.qty,
                'price_unit': l.price_unit,
                'discount': l.discount,
                'subtotal_incl': l.price_subtotal_incl,
            } for l in order.lines],
            'amount_untaxed': order.amount_total - order.amount_tax,
            'amount_tax': order.amount_tax,
            'amount_total': order.amount_total,
            'payments': [{
                'payment_method_id': p.payment_method_id.id,
                'method': p.payment_method_id.name or 'نقدي',
                'amount': p.amount,
            } for p in order.payment_ids],
            'zatca_qr': order.zatca_qr or '',
        }

    @api.model
    def get_zreport_data(self, session_id):
        """بيانات تقرير Z للجلسة لطباعتها من نقطة البيع."""
        session = self.env['pos.session'].browse(session_id)
        if not session.exists():
            return {}
        orders = self.search([('session_id', '=', session_id)])
        sales = sum(o.amount_total for o in orders if not o.is_refund)
        refunds = sum(o.amount_total for o in orders if o.is_refund)
        # تجميع المدفوعات حسب الطريقة
        payments = {}
        for o in orders:
            for p in o.payment_ids:
                name = p.payment_method_id.name or 'أخرى'
                payments[name] = payments.get(name, 0.0) + p.amount
        return {
            'session_name': session.name,
            'config_name': session.config_id.name,
            'user': session.user_id.name,
            'start': fields.Datetime.to_string(session.start_at) if session.start_at else '',
            'order_count': len(orders),
            'total_sales': sales,
            'total_refunds': refunds,
            'net': sales + refunds,
            'payments': [{'name': k, 'amount': v} for k, v in payments.items()],
        }


class PosOrderLine(models.Model):
    _inherit = 'pos.order.line'

    lot_name = fields.Char(string='رقم الدفعة')
    expiry_date = fields.Date(string='تاريخ الصلاحية')

    def _get_dtts_serial(self):
        """الرقم التسلسلي للبيع عبر رصد (من اسم الدفعة أو من pack lot)."""
        self.ensure_one()
        if self.lot_name:
            return self.lot_name
        pack_lots = getattr(self, 'pack_lot_ids', False)
        if pack_lots:
            return pack_lots[0].lot_name
        return False
