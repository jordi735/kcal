import { render } from 'preact';
import { App } from './App';
import './styles.css';
import { initializeTheme } from './theme';

const disposeTheme = initializeTheme();
if (import.meta.hot) import.meta.hot.dispose(disposeTheme);

const root = document.getElementById('root');
if (!root) throw new Error('#root element missing');
render(<App />, root);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js');
  });
}
