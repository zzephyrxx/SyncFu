import {version as appVersion} from '../../package.json';
import {usePrototype} from '../prototype/context';
import {Button} from './ui/UI';
import './settings-information.css';

const icon=new URL('../../assets/syncfu-icon.svg',import.meta.url).href;

export function SettingsAbout({onOpenReleases,busy=false}:{onOpenReleases?:()=>void;busy?:boolean}){
  const {t}=usePrototype();
  return <section className="sf-about" aria-labelledby="sf-about-title">
    <header className="sf-about-brand">
      <img className="sf-about-icon" src={icon} alt="SyncFu" width={96} height={96}/>
      <h2 id="sf-about-title">SyncFu</h2>
      <span className="sf-about-version">{t('appVersion',{version:appVersion})}</span>
      <p className="sf-about-slogan">{t('emptyTitle')}</p>
    </header>
    <dl className="sf-about-details">
      <div><dt>{t('developer')}</dt><dd>Zephyrxx</dd></div>
      <div><dt>{t('platforms')}</dt><dd>Windows · macOS</dd></div>
      <div><dt>{t('licenseLabel')}</dt><dd>Apache-2.0</dd></div>
    </dl>
    <footer className="sf-about-links">
      <a href="https://github.com/zzephyrxx/SyncFu" target="_blank" rel="noreferrer">{t('projectHome')}</a>
      {onOpenReleases&&<Button variant="ghost" disabled={busy} onClick={onOpenReleases}>{t('releases')}</Button>}
    </footer>
  </section>;
}
