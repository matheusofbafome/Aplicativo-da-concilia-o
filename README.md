# Conciliação Bancária Offline

Aplicação HTML/JS/CSS para controlar conciliações bancárias diretamente no navegador.
Os dados são armazenados em IndexedDB, permitindo uso local sem conexão com a internet.

## Recursos
- Importação de lançamentos a partir de arquivos CSV.
- Filtros por data, valor, status, conta e tipo.
- Exportação para CSV ou backup em JSON.
- Sugestão simples de conciliações por valor.
- Suporte offline via Service Worker.

## Desenvolvimento
1. Instale as dependências:
   ```bash
   npm install
   ```
2. Execute os testes automatizados:
   ```bash
   npm test
   ```
3. Abra `index.html` em um navegador moderno para utilizar o aplicativo.

## Licença
Distribuído sob a licença [MIT](LICENSE).
