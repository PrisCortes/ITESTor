-- ITEStore: ejecuta al final. No crea usuarios; créalos desde Authentication > Users.
insert into public.careers (code,name) values
('LA','Licenciatura en Administración'),('LT','Licenciatura en Turismo'),('IGE','Ingeniería en Gestión Empresarial'),('ISA','Ingeniería en Sistemas Automotrices'),('IA','Ingeniería en Alimentarias'),('IE','Ingeniería en Electromecánica'),('IC','Ingeniería Civil'),('IM','Ingeniería en Mecatrónica'),('ISC','Ingeniería en Sistemas Computacionales')
on conflict (code) do update set name = excluded.name;
insert into public.meeting_points (name) values
('Edificio A'),('Edificio B'),('Edificio C'),('Edificio D'),('Edificio E'),('Edificio F'),('Edificio G'),('Polideportivo'),('Asta'),('Árbol de conexión'),('Cafetería')
on conflict (name) do nothing;
