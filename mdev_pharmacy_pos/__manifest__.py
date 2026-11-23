# -*- coding: utf-8 -*-
{
    'name': 'صيدلية - Pharmacy POS',
    'version': '14.0.1.0.4',
    'category': 'Point of Sale',
    'summary': 'نقطة بيع متكاملة للصيدليات: الصلاحية، الدفعات، الوصفات، المخدّرات، رصد/DTTS، ZATCA',
    'description': """
نقطة بيع الصيدليات (Pharmacy POS)
==================================
موديول متكامل يحوّل نقطة بيع أودو إلى نظام صيدلية احترافي:

* تتبّع الدفعات (Lot) وتواريخ الصلاحية مع منع بيع المنتهي وتنبيه قُرب الانتهاء
* بيانات الدواء: المادة الفعّالة، الجرعة، الشكل الصيدلاني، الشركة المصنّعة، البدائل
* الوصفات الطبية: فرضها على الأدوية التي تتطلب وصفة (Rx)
* سجل المواد المخدّرة والمراقَبة مع ربطه بالوصفة والمريض
* تكامل رصد/DTTS (SFDA Track & Trace) على مستوى GTIN+SN
* حقول ومتطلبات الفاتورة الضريبية ZATCA
* تقارير الامتثال وتنبيهات انتهاء التسجيل

تطوير: Hamdy Mahran
    """,
    'author': 'Hamdy Mahran',
    'images': ['static/description/banner.png'],
    'website': 'https://github.com/hamdymahran',
    'license': 'LGPL-3',
    'depends': [
        'point_of_sale',
        'stock',
        'product',
        'account',
    ],
    'data': [
        'security/pharmacy_security.xml',
        'security/ir.model.access.csv',
        'data/sequences.xml',
        'data/cron.xml',
        'views/product_views.xml',
        'views/stock_lot_views.xml',
        'views/prescription_views.xml',
        'views/controlled_substance_views.xml',
        'views/dtts_views.xml',
        'views/loyalty_views.xml',
        'views/promotion_views.xml',
        'views/pos_config_views.xml',
        'views/pos_order_views.xml',
        'views/pharmacy_assets.xml',
        'views/menus.xml',
    ],
    'qweb': [
        'static/src/xml/pharmacy_pos.xml',
    ],
    'installable': True,
    'application': True,
    'auto_install': False,
}
