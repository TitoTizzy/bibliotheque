-- Bibliothèque Edgard Petit - lecture publique des photos de galerie.
-- À exécuter si la page Galerie reste vide alors que le bucket gallery-photos contient des images.

drop policy if exists "Public can list gallery photos storage" on storage.objects;

create policy "Public can list gallery photos storage"
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'gallery-photos');
