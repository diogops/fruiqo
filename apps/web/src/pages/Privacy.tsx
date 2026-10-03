// Política de privacidade (pública, sem login): exigida para o login com Google (D-27) e pela LGPD.
// Descreve o que o Fruiqo faz hoje; se o tratamento de dados mudar, atualize o texto e a data.
import { Link } from 'react-router';
import { BrandMark } from '../components/ui';

const UPDATED = '3 de outubro de 2026';
const CONTROLLER = 'Diogo Daniel';
const CONTACT = 'diogops@gmail.com';

export function Privacy() {
  return (
    <main className="legal">
      <header className="legal-head">
        <Link to="/" className="brand" aria-label="Fruiqo, ir para o início">
          <BrandMark />
          <span className="brand-name">Fruiqo</span>
        </Link>
      </header>
      <article className="legal-body">
        <h1>Política de privacidade</h1>
        <p className="muted">Atualizada em {UPDATED}.</p>
        <p>
          O Fruiqo organiza os filmes, séries, livros e músicas que você salva e sugere o que assistir. Esta política explica,
          em linguagem direta, quais dados usamos, para quê, com quem eles são compartilhados e como você controla tudo isso,
          conforme a Lei Geral de Proteção de Dados (LGPD, Lei 13.709/2018).
        </p>

        <h2>Quem é o responsável</h2>
        <p>
          O responsável pelo tratamento dos dados (controlador) é {CONTROLLER}. Para qualquer pedido sobre os seus dados, escreva
          para <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
        </p>

        <h2>Quais dados usamos</h2>
        <ul>
          <li>
            <strong>Conta:</strong> e-mail e senha. A senha é guardada só como hash (argon2id), nunca em texto. Também guardamos
            as sessões abertas em cada aparelho, para você poder sair de todos.
          </li>
          <li>
            <strong>Login com Google</strong> (quando você escolhe): recebemos do Google o seu e-mail, um identificador da sua
            conta Google e o seu nome. Guardamos só esses três itens: o nome aparece como seu nome de exibição. Não guardamos
            tokens do Google, foto nem nenhum outro dado da sua conta Google, e não acessamos outros serviços do Google.
          </li>
          <li>
            <strong>O que você salva:</strong> links e textos que você compartilha com o app, os títulos do seu catálogo, listas,
            notas, status (quero assistir, assistido…) e a ordem da sua fila.
          </li>
          <li>
            <strong>Prints de tela:</strong> a leitura do texto (OCR) acontece no seu aparelho ou navegador. A imagem nunca é
            enviada; só o texto lido chega ao Fruiqo.
          </li>
          <li>
            <strong>Falar o pedido (microfone):</strong> no "O que assistir hoje?" (site) e no "Como estou" (app), o botão de
            microfone usa o reconhecimento de voz do seu navegador ou do celular (no Chrome e no Android, feito pelo Google,
            no próprio aparelho quando possível; no Safari e no iPhone, pela Apple). O áudio não passa pelo Fruiqo nem é
            guardado por nós; só o texto reconhecido entra no campo, como se você tivesse digitado.
          </li>
          <li>
            <strong>Perfil de gosto:</strong> o resumo que você escreve, favoritos, níveis por gênero e subgênero, títulos que você
            mandou não mostrar mais e os streamings que você diz assinar. Não há conexão com as suas contas nesses serviços.
          </li>
          <li>
            <strong>"Como estou":</strong> o texto que você digita não é guardado. Só a intenção interpretada (por exemplo,
            "algo leve") fica guardada, e apenas se você ligar "Lembrar meu humor", por até 90 dias.
          </li>
          <li>
            <strong>Uso de IA:</strong> para cada chamada a um serviço de IA, registramos o recurso, o modelo, a quantidade de
            tokens e o custo estimado. Nunca registramos o texto enviado nem a resposta.
          </li>
          <li>
            <strong>Registros técnicos:</strong> os registros do servidor não contêm senha, token nem o texto que você
            compartilha. O endereço IP é usado no momento da requisição para limitar tentativas abusivas.
          </li>
        </ul>

        <h2>Para que usamos</h2>
        <p>
          Para manter a sua conta, organizar o seu catálogo, encontrar onde cada título está disponível e sugerir o que assistir,
          ler ou ouvir de acordo com o seu pedido e o seu gosto, além de proteger o serviço contra abuso. Não vendemos dados, não
          exibimos publicidade e não usamos ferramentas de rastreamento ou analytics de terceiros.
        </p>

        <h2>Com quem compartilhamos</h2>
        <p>Só com os serviços necessários para o Fruiqo funcionar, e só o mínimo de que cada um precisa:</p>
        <ul>
          <li>
            <strong>Railway e Vercel:</strong> hospedam o servidor, o banco de dados e o site.
          </li>
          <li>
            <strong>TMDB (The Movie Database):</strong> recebe os títulos que buscamos para trazer capa, sinopse, notas e onde
            assistir (dados de disponibilidade da JustWatch). Não enviamos quem você é.
          </li>
          <li>
            <strong>Open Library:</strong> recebe os títulos de livros buscados, sem dados pessoais.
          </li>
          <li>
            <strong>Anthropic (Claude), só se você permitir a IA no Perfil:</strong> recebe o texto que você digita no "Como
            estou" e nas buscas por descrição, o texto lido dos prints que você importar e, no "O que assistir hoje?", o seu
            pedido, o perfil que você declarou e os nomes de títulos da sua lista.
          </li>
          <li>
            <strong>OpenAI, só se você permitir a IA no Perfil:</strong> no "O que assistir hoje?", recebe o seu pedido, o perfil
            declarado e os nomes de títulos da sua lista para sugerir títulos. A OpenAI guarda essas chamadas por até 30 dias
            para monitorar abuso.
          </li>
          <li>
            <strong>Google:</strong> só quando você entra com o Google, para confirmar a sua identidade.
          </li>
        </ul>
        <p>
          Os serviços de IA são contratados para processar o pedido e devolver a resposta; pelas regras deles, os dados enviados
          pela API não são usados para treinar modelos. Nenhum dado vindo do TMDB é enviado à IA, exceto os nomes dos títulos.
        </p>

        <h2>Transferência para fora do Brasil</h2>
        <p>
          Esses serviços ficam fora do Brasil (principalmente nos Estados Unidos). O envio de dados aos serviços de IA depende do
          seu consentimento, que você pode dar e retirar a qualquer momento em Perfil → Privacidade.
        </p>

        <h2>Por quanto tempo guardamos</h2>
        <p>
          Enquanto a sua conta existir. Ao excluir a conta, tudo o que está nela é apagado na hora, de forma definitiva: catálogo,
          listas, perfil, histórico e sessões. Algumas informações têm prazo menor: a intenção do "Como estou" fica no máximo 90
          dias, e dados de livros vindos da Open Library são renovados a cada 30 dias. Cópias de segurança mantidas pela
          hospedagem podem levar um curto período para serem substituídas.
        </p>

        <h2>Seus direitos</h2>
        <p>
          Você pode, a qualquer momento: ver e corrigir os seus dados no próprio app; retirar o consentimento para a IA (Perfil →
          Privacidade); desligar "Lembrar meu humor" (o que apaga o histórico guardado); excluir a sua conta e todos os dados
          (Perfil → Excluir minha conta); e pedir confirmação, acesso, portabilidade ou informações sobre o compartilhamento
          pelo e-mail <a href={`mailto:${CONTACT}`}>{CONTACT}</a>. Você também pode reclamar à Autoridade Nacional de Proteção de
          Dados (ANPD).
        </p>

        <h2>Segurança</h2>
        <p>
          Todo o tráfego usa HTTPS. As senhas ficam só como hash, a sessão do site usa cookie protegido (httpOnly) e o banco de
          dados isola os dados de cada pessoa, de modo que uma conta não consegue ler os dados de outra.
        </p>

        <h2>Crianças</h2>
        <p>O Fruiqo não é destinado a menores de 13 anos.</p>

        <h2>Mudanças nesta política</h2>
        <p>
          Se mudarmos a forma de tratar os seus dados, atualizamos esta página e a data no topo. Mudanças relevantes também serão
          avisadas no app.
        </p>

        <p className="legal-foot">
          <Link to="/">Voltar ao Fruiqo</Link>
        </p>
      </article>
    </main>
  );
}
