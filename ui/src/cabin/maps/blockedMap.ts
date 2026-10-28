/**
 * What the Maps app says instead of the map when the player plays on a map ATS GPS doesn't allow (the host
 * tells: a map by HVT, Heavy Vehicles Turkey), in the game's language: every language the game has, by
 * its own codes (`locale/<code>` in its archives). HVT and ATS GPS are names, the same in every language.
 * The game shows Silesian players Polish (pl_si), and so does this.
 */
export const HVT_MAP_MESSAGES: Record<string, string> = {
  bg_bg: 'Картите от HVT не са разрешени в ATS GPS. Свържете се с ATS GPS, за да научите повече.',
  ca_es: "Els mapes d'HVT no estan permesos a ATS GPS. Contacta amb ATS GPS per saber-ne més.",
  cs_cz: 'Mapy od HVT nejsou ve ATS GPS povoleny. Pro více informací kontaktujte ATS GPS.',
  da_dk: 'Kort fra HVT er ikke tilladt i ATS GPS. Kontakt ATS GPS for at få mere at vide.',
  de_de: 'Karten von HVT sind in ATS GPS nicht erlaubt. Kontaktiere ATS GPS, um mehr zu erfahren.',
  el_gr: 'Οι χάρτες της HVT δεν επιτρέπονται στο ATS GPS. Επικοινωνήστε με το ATS GPS για να μάθετε περισσότερα.',
  en_gb: 'Maps by HVT are not allowed in ATS GPS. Contact ATS GPS to learn more.',
  en_us: 'Maps by HVT are not allowed in ATS GPS. Contact ATS GPS to learn more.',
  es_es: 'Los mapas de HVT no están permitidos en ATS GPS. Contacta con ATS GPS para saber más.',
  es_la: 'Los mapas de HVT no están permitidos en ATS GPS. Comunícate con ATS GPS para saber más.',
  et_ee: 'HVT kaardid ei ole ATS GPS-s lubatud. Lisateabe saamiseks võta ühendust ATS GPS-ga.',
  eu_es: 'HVTren mapak ez daude baimenduta ATS GPS-n. Jarri harremanetan ATS GPS-rekin gehiago jakiteko.',
  fi_fi: 'HVT:n kartat eivät ole sallittuja ATS GPS-ssa. Ota yhteyttä ATS GPS-hin saadaksesi lisätietoja.',
  fr_ca: 'Les cartes de HVT ne sont pas permises dans ATS GPS. Communiquez avec ATS GPS pour en savoir plus.',
  fr_fr: 'Les cartes de HVT ne sont pas autorisées dans ATS GPS. Contactez ATS GPS pour en savoir plus.',
  gl_es: 'Os mapas de HVT non están permitidos en ATS GPS. Contacta con ATS GPS para saber máis.',
  hr_hr: 'Karte od HVT-a nisu dopuštene u ATS GPS-u. Za više informacija obratite se ATS GPS-u.',
  hu_hu: 'A HVT térképei nem engedélyezettek a ATS GPS-ben. További információért lépj kapcsolatba a ATS GPS-jel.',
  it_it: 'Le mappe di HVT non sono consentite in ATS GPS. Contatta ATS GPS per saperne di più.',
  ja_jp: 'HVTのマップはATS GPSでは使用できません。詳しくはATS GPSにお問い合わせください。',
  ka_ge: 'HVT-ის რუკები ATS GPS-ში დაშვებული არ არის. მეტის გასაგებად დაუკავშირდით ATS GPS-ს.',
  ko_kr: 'HVT의 지도는 ATS GPS에서 허용되지 않습니다. 자세한 내용은 ATS GPS에 문의하세요.',
  lt_lt: 'HVT žemėlapiai ATS GPS neleidžiami. Norėdami sužinoti daugiau, susisiekite su ATS GPS.',
  lv_lv: 'HVT kartes ATS GPS nav atļautas. Lai uzzinātu vairāk, sazinieties ar ATS GPS.',
  mk_mk: 'Мапите од HVT не се дозволени во ATS GPS. Контактирајте го ATS GPS за да дознаете повеќе.',
  nl_nl: 'Kaarten van HVT zijn niet toegestaan in ATS GPS. Neem contact op met ATS GPS voor meer informatie.',
  no_no: 'Kart fra HVT er ikke tillatt i ATS GPS. Kontakt ATS GPS for å finne ut mer.',
  pl_pl: 'Mapy od HVT nie są dozwolone w ATS GPS. Skontaktuj się z ATS GPS, aby dowiedzieć się więcej.',
  pl_si: 'Mapy od HVT nie są dozwolone w ATS GPS. Skontaktuj się z ATS GPS, aby dowiedzieć się więcej.',
  pt_br: 'Mapas da HVT não são permitidos no ATS GPS. Entre em contato com o ATS GPS para saber mais.',
  pt_pt: 'Os mapas da HVT não são permitidos no ATS GPS. Contacte o ATS GPS para saber mais.',
  ro_ro: 'Hărțile HVT nu sunt permise în ATS GPS. Contactează ATS GPS pentru a afla mai multe.',
  ru_ru: 'Карты от HVT не разрешены в ATS GPS. Свяжитесь с ATS GPS, чтобы узнать больше.',
  sk_sk: 'Mapy od HVT nie sú vo ATS GPS povolené. Pre viac informácií kontaktujte ATS GPS.',
  sl_sl: 'Zemljevidi HVT v ATS GPS-u niso dovoljeni. Za več informacij se obrnite na ATS GPS.',
  sr_sp: 'Mape od HVT-a nisu dozvoljene u ATS GPS-u. Kontaktirajte ATS GPS da saznate više.',
  sr_sr: 'Мапе од HVT-а нису дозвољене у ATS GPS-у. Контактирајте ATS GPS да сазнате више.',
  sv_se: 'Kartor från HVT är inte tillåtna i ATS GPS. Kontakta ATS GPS för att få veta mer.',
  tr_tr: "HVT haritalarına ATS GPS'de izin verilmiyor. Daha fazla bilgi için ATS GPS ile iletişime geçin.",
  uk_uk: "Карти від HVT не дозволені у ATS GPS. Зв'яжіться з ATS GPS, щоб дізнатися більше.",
  vi_vn: 'Bản đồ của HVT không được phép sử dụng trong ATS GPS. Liên hệ ATS GPS để tìm hiểu thêm.',
  zh_cn: 'ATS GPS 不允许使用 HVT 的地图。如需了解详情，请联系 ATS GPS。',
  zh_tw: 'ATS GPS 不允許使用 HVT 的地圖。如需瞭解詳情，請聯絡 ATS GPS。',
}

/** The message in the game's `language`, or English for one not listed (a mod's). */
export function hvtMapMessage(language: string | null): string {
  return HVT_MAP_MESSAGES[language ?? ''] ?? HVT_MAP_MESSAGES.en_us
}
