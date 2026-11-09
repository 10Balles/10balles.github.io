-- Équipe Dix Balles : les e-mails qui peuvent valider, modifier et supprimer des plans.
-- Remplace les adresses ci-dessous par les vraies (en minuscules), puis lance la requête.
insert into public.team (email) values
  ('prenom.nom@exemple.fr'),
  ('autre.membre@exemple.fr')
on conflict (email) do nothing;

-- Pour retirer quelqu'un :
-- delete from public.team where email = 'prenom.nom@exemple.fr';
