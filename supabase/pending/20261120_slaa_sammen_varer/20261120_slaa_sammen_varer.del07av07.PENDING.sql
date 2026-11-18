-- VENTER PÅ ROOT. 20261120_slaa_sammen_varer.del07av07.PENDING.sql – del 7 av 7 («kjør») av 20261120_slaa_sammen_varer.PENDING.sql.
-- Kontrollerer at del 1–6 er skrevet inn riktig og at hele teksten har md5 4c1a6dc770cded4c789587cae6ea3a35
-- (= originalfilen uten egen begin/commit), kjører den i ÉN transaksjon og fjerner mellomlagringen.
-- Feiler noe, rulles alt tilbake og mellomlagringen står igjen, slik at feil del kan skrives inn på nytt.

begin;

do $g$
declare v text; v_bad int;
begin
  if to_regclass('public._rm_sql_stage') is null then raise exception 'Kjør del 01 først'; end if;
  select count(*) into v_bad from (values
    (1, 'e243c19959b8b8d712d377d9b4ed2e98'),
    (2, 'e2feb7079dc710126bc2d9d0180f35d9'),
    (3, '024e58e5d9b7ba5cc92484f04182bb22'),
    (4, '8ab670c0bf53f07efdcf50acbe773489'),
    (5, '328e40ac1258fd3ed04b6079aca0a4ae'),
    (6, '49c0baceda8f751d9d4b3cdd4bbbdbf3')
  ) e(part, m) left join public._rm_sql_stage s on s.file = '20261120_slaa_sammen_varer' and s.part = e.part
  where s.body is null or md5(s.body) <> e.m;
  if v_bad > 0 then raise exception '% del(er) mangler eller er feil skrevet inn – kjør .check for hver del', v_bad; end if;
  if (select count(*) from public._rm_sql_stage where file = '20261120_slaa_sammen_varer') <> 6 then raise exception 'Uventet antall deler i mellomlagringen'; end if;
  select string_agg(body, '' order by part) into v from public._rm_sql_stage where file = '20261120_slaa_sammen_varer';
  if md5(v) <> '4c1a6dc770cded4c789587cae6ea3a35' then raise exception 'Hele teksten avviker fra den gjennomgåtte filen (md5)'; end if;
  execute v;
  delete from public._rm_sql_stage where file = '20261120_slaa_sammen_varer';
end $g$;

do $g$ begin if not exists (select 1 from public._rm_sql_stage) then drop table public._rm_sql_stage; end if; end $g$;

commit;
