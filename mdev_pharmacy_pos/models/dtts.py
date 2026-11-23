# -*- coding: utf-8 -*-
import logging

from odoo import models, fields, api, _
from odoo.exceptions import UserError

_logger = logging.getLogger(__name__)

try:
    from zeep import Client
except ImportError:
    Client = None
    _logger.warning('مكتبة zeep غير مثبّتة - تكامل رصد/DTTS معطّل. ثبّتها: pip install zeep')


class DttsConfig(models.Model):
    _name = 'dtts.config'
    _description = 'إعدادات اتصال رصد / DTTS'

    name = fields.Char(string='اسم الإعداد', required=True)
    environment = fields.Selection([
        ('test', 'بيئة الاختبار'),
        ('production', 'بيئة الإنتاج'),
    ], string='البيئة', default='test', required=True)
    wsdl_url = fields.Char(string='رابط WSDL', help='يُحدَّد بعد التسجيل في SFDA')
    username = fields.Char(string='اسم مستخدم رصد')
    password = fields.Char(string='كلمة مرور رصد')
    gln_id = fields.Char(string='GLN ID', required=True,
                         help='الرقم التعريفي الموقعي من SFDA/GS1')
    stakeholder_type = fields.Selection([
        ('manufacturer', 'مصنّع'),
        ('warehouse', 'مستودع'),
        ('consumption_center', 'مركز استهلاك'),
        ('pharmacy', 'صيدلية'),
    ], string='نوع الطرف', required=True, default='pharmacy')
    active = fields.Boolean(default=True)


class DttsTransaction(models.Model):
    _name = 'dtts.transaction'
    _description = 'سجل عمليات رصد / DTTS'
    _order = 'create_date desc'

    name = fields.Char(
        string='مرجع العملية', required=True, copy=False, readonly=True,
        default=lambda self: self.env['ir.sequence'].next_by_code('dtts.transaction'))
    operation_type = fields.Selection([
        ('supply', 'Supply Product'),
        ('import_product', 'Import Product'),
        ('dispatch', 'Dispatch'),
        ('accept', 'Accept'),
        ('consume', 'Consume'),
        ('pharmacy_sale', 'Pharmacy Sale'),
        ('pharmacy_sale_cancel', 'Pharmacy Sale Cancel'),
        ('deactivate', 'Deactivate'),
        ('return_product', 'Return'),
        ('transfer', 'Transfer'),
    ], string='نوع العملية', required=True)
    gtin = fields.Char(string='GTIN', required=True)
    serial_number = fields.Char(string='SN - الرقم التسلسلي')
    batch_number = fields.Char(string='BN - رقم الدفعة')
    expiry_date = fields.Date(string='XD - تاريخ الانتهاء')
    sender_gln = fields.Char(string='GLN المُرسِل')
    receiver_gln = fields.Char(string='GLN المستقبِل')
    state = fields.Selection([
        ('draft', 'مسودة'),
        ('sent', 'مُرسَل'),
        ('success', 'ناجح'),
        ('error', 'خطأ'),
    ], default='draft', string='الحالة')
    response_code = fields.Char(string='كود الاستجابة')
    response_message = fields.Text(string='رسالة الاستجابة')
    request_xml = fields.Text(string='XML المُرسَل')
    response_xml = fields.Text(string='XML المُستقبَل')
    lot_id = fields.Many2one('stock.lot', string='الدفعة في Odoo')
    pos_order_id = fields.Many2one('pos.order', string='طلب نقطة البيع')


class DttsService(models.AbstractModel):
    _name = 'dtts.service'
    _description = 'خدمة اتصال رصد / DTTS (SOAP)'

    @api.model
    def _get_config(self):
        config = self.env['dtts.config'].search([('active', '=', True)], limit=1)
        if not config:
            raise UserError(_('لم يتم إعداد بيانات اتصال رصد/DTTS!'))
        return config

    @api.model
    def _get_client(self):
        if Client is None:
            raise UserError(_('مكتبة zeep غير مثبّتة. نفّذ: pip install zeep'))
        config = self._get_config()
        if not config.wsdl_url:
            raise UserError(_('رابط WSDL غير مُعدّ في إعدادات رصد.'))
        try:
            return Client(config.wsdl_url), config
        except Exception as e:
            raise UserError(_('فشل الاتصال بـ رصد: %s') % str(e))

    def _log(self, vals, result):
        vals.update({
            'state': 'success' if result.get('success') else 'error',
            'response_code': result.get('error_code'),
            'response_message': result.get('message') or result.get('error'),
        })
        return self.env['dtts.transaction'].create(vals)

    # ------------------------------------------------------------------
    # بيع الدواء للمريض (العملية الأساسية لنقطة البيع)
    # ------------------------------------------------------------------
    @api.model
    def pharmacy_sale(self, gtin, serial_no, pos_order_id=False, lot_id=False):
        """إرسال Pharmacy Sale Service عند بيع دواء متتبَّع تسلسلياً"""
        try:
            client, config = self._get_client()
            response = client.service.PharmacySale(
                username=config.username,
                password=config.password,
                GTIN=gtin,
                SN=serial_no,
            )
            result = self._process_response(response)
        except UserError as e:
            result = {'success': False, 'error': str(e)}
        except Exception as e:
            _logger.exception('خطأ رصد Pharmacy Sale')
            result = {'success': False, 'error': str(e)}
        self._log({
            'operation_type': 'pharmacy_sale',
            'gtin': gtin, 'serial_number': serial_no,
            'pos_order_id': pos_order_id, 'lot_id': lot_id,
            'sender_gln': self._get_config().gln_id,
        }, result)
        return result

    @api.model
    def pharmacy_sale_cancel(self, gtin, serial_no, pos_order_id=False):
        try:
            client, config = self._get_client()
            response = client.service.PharmacySaleCancel(
                username=config.username, password=config.password,
                GTIN=gtin, SN=serial_no)
            result = self._process_response(response)
        except Exception as e:
            result = {'success': False, 'error': str(e)}
        self._log({
            'operation_type': 'pharmacy_sale_cancel',
            'gtin': gtin, 'serial_number': serial_no,
            'pos_order_id': pos_order_id,
        }, result)
        return result

    @api.model
    def accept(self, gtin, serial_no, lot_id=False):
        """قبول منتج مُرسَل من المستودع"""
        try:
            client, config = self._get_client()
            response = client.service.Accept(
                username=config.username, password=config.password,
                GTIN=gtin, SN=serial_no)
            result = self._process_response(response)
        except Exception as e:
            result = {'success': False, 'error': str(e)}
        self._log({
            'operation_type': 'accept',
            'gtin': gtin, 'serial_number': serial_no, 'lot_id': lot_id,
        }, result)
        return result

    def _process_response(self, response):
        if hasattr(response, 'ErrorCode') and response.ErrorCode:
            return {
                'success': False,
                'error_code': str(response.ErrorCode),
                'message': getattr(response, 'ErrorDescription', '') or _('خطأ غير معروف'),
            }
        return {'success': True, 'message': _('تمت العملية بنجاح')}


class ResPartner(models.Model):
    _inherit = 'res.partner'

    dtts_gln = fields.Char(string='GLN (رصد)', help='الرقم التعريفي الموقعي للشريك')
