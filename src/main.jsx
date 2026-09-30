import React from 'react';
import ReactDOM from 'react-dom/client';
import { ClerkProvider } from '@clerk/clerk-react';
import App from './App';
import './index.css';

// Publishable key é pública por design — seguro estar no código
const PUBLISHABLE_KEY = 'pk_test_Y29tcG9zZWQta29hbGEtNjIuY2xlcmsuYWNjb3VudHMuZGV2JA';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {/* Navegação de SPA para os redirects do Clerk. Sem isto o Clerk usa
        window.location.href = destino e espera a página recarregar para publicar
        a sessão — mas destino que só difere no hash (#escala/…, #controle) não
        recarrega, e o app ficava em branco após o login até um F5. */}
    <ClerkProvider
      publishableKey={PUBLISHABLE_KEY}
      routerPush={(to) => window.history.pushState(null, '', to)}
      routerReplace={(to) => window.history.replaceState(null, '', to)}
    >
      <App />
    </ClerkProvider>
  </React.StrictMode>
);
