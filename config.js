/* Réglages du site Dix Balles.
   supabaseUrl et supabaseKey : Supabase > Project Settings > API (« Project URL » et clé « publishable » ou « anon »).
   Cette clé est faite pour être publique : la sécurité vient des règles d'accès de la base (supabase/schema.sql).
   Ne mets JAMAIS ici la clé « secret » ou « service_role ». */
window.DIXBALLES = {
  supabaseUrl: "https://cxzbnhdnjrprgnzzondl.supabase.co",
  supabaseKey: "sb_publishable_KZoePNNq7o2EmnqV4_yYuQ_uhaN91fM",
  instagram: "@10balle.s",
  instagramUrl: "https://www.instagram.com/10balle.s/",
  // Clé gratuite CARTO (https://carto.com/basemaps/apikey/) pour le fond de carte Positron.
  // Vide : la carte utilise OpenStreetMap en gris. Cette clé est publique, comme la clé Supabase.
  cartoKey: ""
};
