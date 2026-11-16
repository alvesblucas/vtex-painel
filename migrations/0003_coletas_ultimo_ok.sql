-- Última coleta bem-sucedida de cada fonte, separada da última tentativa (quando/ok/erro):
-- uma falha atualiza só a tentativa e o "dados até" continua valendo.
-- Aditiva: as linhas que já existem com ok = 1 herdam o próprio quando.
ALTER TABLE coletas ADD COLUMN ultimo_ok TEXT;
UPDATE coletas SET ultimo_ok = quando WHERE ok = 1;
