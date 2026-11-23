# -*- coding: utf-8 -*-
from odoo import models, fields, api


class PosConfigPharmacyData(models.Model):
    """Data the point-of-sale interface needs, in one call (Odoo 13+)."""
    _inherit = 'pos.config'

    def _pharmacy_lot_model(self):
        # stock.production.lot was renamed stock.lot in Odoo 16
        return 'stock.lot' if 'stock.lot' in self.env else 'stock.production.lot'

    def get_pharmacy_pos_data(self):
        self.ensure_one()
        today = fields.Date.context_today(self)
        threshold = self.expiry_warning_days or 90
        Product = self.env['product.product']

        flagged = Product.search([
            '|', '|',
            ('is_pharmaceutical', '=', True),
            ('requires_prescription', '=', True),
            ('is_controlled', '=', True),
        ])
        products = {}
        for p in flagged:
            products[p.id] = {
                'is_pharmaceutical': p.is_pharmaceutical,
                'requires_prescription': p.requires_prescription or p.is_controlled,
                'is_controlled': p.is_controlled,
                'gtin': p.gtin or '',
                'track_serial_dtts': p.track_serial_dtts,
                'scientific_name': p.pharma_scientific_name or '',
            }

        lots = {}
        pharma_ids = flagged.filtered('is_pharmaceutical').ids
        if pharma_ids:
            for lot in self.env[self._pharmacy_lot_model()].sudo().search(
                    [('product_id', 'in', pharma_ids)]):
                expiry = lot.pharma_expiry_date
                if not expiry:
                    status, days = 'none', 0
                else:
                    days = (expiry - today).days
                    status = 'expired' if days < 0 else ('warning' if days <= threshold else 'valid')
                lots.setdefault(lot.product_id.id, []).append({
                    'id': lot.id,
                    'name': lot.name,
                    'expiry_date': expiry and expiry.isoformat() or False,
                    'days_remaining': days,
                    'expiry_status': status,
                    'serial': lot.dtts_serial or '',
                })

        promotions = []
        if self.enable_promotions:
            for promo in self.env['pharmacy.promotion'].sudo().get_active_promotions():
                product_ids = set(promo['product_ids'])
                if promo['promo_type'] == 'category_percent' and promo['categ_ids']:
                    product_ids |= set(Product.search(
                        [('categ_id', 'child_of', promo['categ_ids'])]).ids)
                promo['product_ids'] = sorted(product_ids)
                promotions.append(promo)

        loyalty = False
        if self.enable_loyalty:
            conf = self.env['pharmacy.loyalty.config'].sudo().search([('active', '=', True)], limit=1)
            if conf:
                loyalty = conf.read([
                    'name', 'earn_points_per_currency', 'redeem_value_per_point',
                    'min_redeem_points', 'max_redeem_percent', 'exclude_controlled'])[0]

        return {
            'config': {
                'pharmacy_mode': self.pharmacy_mode,
                'block_expired': self.block_expired,
                'warn_near_expiry': self.warn_near_expiry,
                'enforce_prescription': self.enforce_prescription,
                'log_controlled': self.log_controlled,
                'enable_loyalty': self.enable_loyalty,
                'enable_promotions': self.enable_promotions,
            },
            'products': products,
            'lots': lots,
            'promotions': promotions,
            'loyalty': loyalty,
        }

    @api.model
    def get_partner_loyalty_points(self, partner_id):
        partner = self.env['res.partner'].sudo().browse(partner_id)
        return partner.exists() and partner.loyalty_points or 0.0
