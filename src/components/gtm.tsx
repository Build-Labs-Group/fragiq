import { gtmId, PROJETO_BUILDLABS, URL_PRODUCAO } from "@/lib/site";

/**
 * Script do `<head>`: dataLayer inicial (`buildlabs_projeto`, `buildlabs_ambiente`),
 * Consent Mode v2 com tudo `denied` por padrão (LGPD) e o carregamento do GTM.
 * Se a pessoa já aceitou antes (localStorage), o consentimento é atualizado
 * antes do GTM disparar qualquer tag. Sem ID, não renderiza nada.
 */
export function GtmHead() {
  const id = gtmId();
  if (!id) return null;
  const host = new URL(URL_PRODUCAO).host;
  const codigo = `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}
gtag('consent','default',{ad_storage:'denied',analytics_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',wait_for_update:500});
try{if(localStorage.getItem('buildlabs_consent')==='granted'){gtag('consent','update',{ad_storage:'granted',analytics_storage:'granted',ad_user_data:'granted',ad_personalization:'granted'})}}catch(e){}
dataLayer.push({buildlabs_projeto:'${PROJETO_BUILDLABS}',buildlabs_ambiente:location.hostname==='${host}'?'producao':'desenvolvimento'});
(function(w,d,s,l,i){w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s);j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i;f.parentNode.insertBefore(j,f)})(window,document,'script','dataLayer','${id}');`;
  return <script id="gtm-init" dangerouslySetInnerHTML={{ __html: codigo }} />;
}

/** Primeiro elemento do `<body>`, para quem navega sem JavaScript. */
export function GtmNoscript() {
  const id = gtmId();
  if (!id) return null;
  return (
    <noscript>
      <iframe src={`https://www.googletagmanager.com/ns.html?id=${id}`} height="0" width="0" style={{ display: "none", visibility: "hidden" }} title="Google Tag Manager" />
    </noscript>
  );
}
