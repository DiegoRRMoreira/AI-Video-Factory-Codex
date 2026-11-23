# AI Video Factory — Codex + Kairogen

Versão comunitária de [AI Video Factory, de Ersin KOÇ](https://github.com/ersinkoc/AI-Video-Factory), com adaptações para usar modelos do Codex nas etapas de produção e o Kairogen para gerar mídia. Mantém o histórico, os créditos e a licença MIT do projeto original.

## O que foi adicionado

- Configuração dos papéis de roteiro, direção e revisão com Codex via ACP.
- Login Kairogen por código de dispositivo, renovação de sessão e consultas de catálogo e preço.
- Geração de imagens e vídeos com limite em créditos, identificadores persistentes e retomada de trabalhos aceitos.
- Edição local de Reels com logotipo, títulos, narração existente e música sintetizada.
- Inicialização no Windows sem caminhos fixos de um computador específico.

## Instalação

Requisitos: Node.js 24 ou superior, pnpm 11.25.0, FFmpeg completo com ffprobe e um navegador compatível com Remotion. Para os agentes Codex, use seu próprio login Codex/ChatGPT ou uma credencial compatível. Para gerar mídia no Kairogen, conecte sua conta com plano e créditos adequados. Essas contas e seus limites são independentes.

```powershell
git clone https://github.com/DiegoRRMoreira/AI-Video-Factory-Codex.git
cd AI-Video-Factory-Codex
pnpm install --frozen-lockfile
Copy-Item .env.example .env
pnpm codex:setup
```

O último comando descobre os modelos disponíveis, sem enviar uma solicitação de geração. Escolha um dos identificadores retornados para configurar todos os papéis, por exemplo:

```powershell
pnpm codex:setup gpt-6.2-sol
pnpm kairogen connect
# Abra o endereço exibido, autorize com sua conta e volte ao terminal:
pnpm kairogen finish
pnpm kairogen account
pnpm kairogen models
```

Os modelos disponíveis dependem do seu acesso. A instalação não conecta automaticamente a conta de quem publicou este repositório.

## Abrir o Studio

```powershell
pnpm studio
```

Abra `http://127.0.0.1:3100`. No Windows também existe `./start-local.ps1`: ele encontra uma instalação portátil de FFmpeg sob `.data/tools/ffmpeg/*/bin` ou usa `YS_FFMPEG_BIN`/PATH. O FFmpeg não é distribuído neste repositório. Em `.env`, `YS_BROWSER_EXECUTABLE` pode apontar para seu Chrome instalado, se necessário.

## Gerar mídia com orçamento em créditos

Prepare um JSON com os argumentos do modelo. O catálogo informa os parâmetros e durações aceitos. Um exemplo está em [examples/reels/video-request.example.json](examples/reels/video-request.example.json).

```powershell
pnpm kairogen quote examples/reels/video-request.example.json
pnpm kairogen:generate examples/reels/video-request.example.json --max-credits 200 --out out/my-reel
```

Sem `--submit`, o segundo comando só mostra a cotação. Acrescente `--submit` para autorizar a geração com seu saldo. O teto deve ser escolhido por você a partir da cotação atual; os números do exemplo não garantem um preço futuro. Uma execução interrompida retoma o identificador salvo. Não remova os arquivos de trabalhos para forçar outra cobrança.

Para inserir o provedor no fluxo automático do Studio, configure `KAIROGEN_ENABLED` e os modelos conforme [docs/KAIROGEN.md](docs/KAIROGEN.md). O orçamento nativo do Studio é em USD; sua conversão contábil deve ser configurada explicitamente. O comando de geração acima trabalha diretamente em créditos, sem inventar uma taxa de câmbio.

## Finalizar um Reels localmente

Tenha um vídeo com a narração já aplicada e seu próprio logotipo. Copie e ajuste [examples/reels/brand.example.json](examples/reels/brand.example.json), incluindo os caminhos dos arquivos e os títulos:

```powershell
pnpm reel:render examples/reels/my-brand.json
```

A rotina gera um MP4 vertical de 20 segundos em 1080 × 1920, com música local e títulos. Não consome APIs. A definição de narração e a geração da mídia são etapas separadas; o arquivo de entrada precisa conter áudio. Os exemplos não incluem logotipos, vozes, arquivos de clientes ou vídeos gerados.

## Estado da validação

A integração de mídia passou em 183 testes locais, e a checagem de tipos passou. Um Reels real foi produzido com vídeo e narração Kairogen, logotipo/títulos aplicados localmente e saída final verificada em 1080 × 1920, 30 fps e 20 segundos. O custo daquela produção foi 202 créditos; não é uma tabela de preços.

A descoberta dos modelos Codex e a seleção dos papéis no Studio foram verificadas. Um episódio completo passando automaticamente pelos 31 papéis ainda não foi validado. A execução de testes/CI em outro computador também é uma verificação separada. O workflow original mantém suas próprias exigências de cobertura.

## Credenciais e arquivos pessoais

`.env`, `.data`, `out`, dependências e resultados locais estão ignorados pelo Git. Tokens Kairogen ficam somente no diretório local de autenticação. Use as credenciais de cada usuário e não envie essas pastas ao compartilhar o código.

## Origem e licença

Código original © 2026 Ersin KOÇ, sob [licença MIT](LICENSE). Esta versão adiciona as integrações descritas acima e não é uma distribuição oficial do autor original, da OpenAI ou do Kairogen. Componentes de terceiros, como Remotion, e mídias geradas mantêm suas próprias condições de uso.
