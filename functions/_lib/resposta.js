const CABECALHOS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };

export class ErroHttp extends Error {
  constructor(status, codigo, mensagem) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
    this.mensagem = mensagem;
  }
}

export function json(dados, status = 200) {
  return new Response(JSON.stringify(dados), { status, headers: CABECALHOS });
}

export function erro(status, codigo, mensagem) {
  return json({ erro: codigo, mensagem }, status);
}
