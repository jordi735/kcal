import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { ArrowLeftIcon, ArrowRightIcon, SparklesIcon } from './Icon';
import styles from './ChatGPTGuide.module.css';

const MCP_URL = 'https://usekcal.com/mcp';

export function ChatGPTConnectCard({ onOpen }: { onOpen: (button: HTMLButtonElement) => void }) {
  return (
    <button
      type="button"
      aria-label="Connect to ChatGPT"
      className={styles.card}
      onClick={(event) => onOpen(event.currentTarget)}
    >
      <span className={styles.cardIcon}><SparklesIcon size={20} /></span>
      <span className={styles.cardText}>
        <span className={styles.cardTitle}>Connect to ChatGPT</span>
        <span className={styles.cardDescription}>Add foods from photos, log meals, and more.</span>
      </span>
      <ArrowRightIcon className={styles.cardArrow} />
    </button>
  );
}

// A guide is a local view of its host sheet. Keep the host's fields mounted so
// returning never serializes a draft or resets an unfinished numeric field.
export function useChatGPTGuide() {
  const [guideOpen, setGuideOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);

  // Run during commit so a delayed initial effect cannot clear the trigger
  // after a quick opening click but before the guide's first render.
  useLayoutEffect(() => {
    if (!guideOpen && trigger.current !== null) {
      // Inputs clear on focus in these forms; restore the opening button instead.
      trigger.current.focus({ preventScroll: true });
      trigger.current = null;
    }
  }, [guideOpen]);

  return {
    guideOpen,
    openGuide: (button: HTMLButtonElement) => {
      trigger.current = button;
      setGuideOpen(true);
    },
    closeGuide: () => setGuideOpen(false),
  };
}

export function ChatGPTGuide({ onBack }: { onBack: () => void }) {
  const heading = useRef<HTMLHeadingElement | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);

  const copyUrl = async () => {
    setCopyState('copying');
    try {
      await navigator.clipboard.writeText(MCP_URL);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  };

  return (
    <>
      <div className={styles.header}>
        <button type="button" className={styles.back} onClick={onBack}>
          <ArrowLeftIcon /> Back
        </button>
        <span className={`mono tiny caps ${styles.eyebrow}`}>Connection guide</span>
      </div>
      <div data-sheet-scroll className={`no-scroll ${styles.content}`}>
        <div className={styles.intro}>
          <div className={styles.heroIcon}><SparklesIcon size={26} /></div>
          <h1 ref={heading} tabIndex={-1}>Connect KCAL to ChatGPT</h1>
          <p>Use photos to add foods, log your meals, and ask about your macros — right in ChatGPT.</p>
          <span className={`mono tiny ${styles.desktopNote}`}>Set up in a web browser on a PC or Mac</span>
        </div>

        <ol className={styles.steps}>
          <li>
            <h2>Open ChatGPT on the web</h2>
            <p>Sign in to ChatGPT in a web browser on your PC or Mac.</p>
          </li>
          <li>
            <h2>Add a custom connection</h2>
            <p>Open <strong>Plugins</strong>, select the <strong>+</strong> button, then choose <strong>Add custom MCP server</strong>.</p>
            <p>If that option is missing, look in ChatGPT’s <strong>Settings</strong> for <strong>Developer mode</strong>. Enable it if available, then return to Plugins.</p>
          </li>
          <li>
            <h2>Enter KCAL’s details</h2>
            <dl className={styles.details}>
              <div><dt>Name</dt><dd>KCAL</dd></div>
              <div><dt>Authentication</dt><dd>OAuth</dd></div>
            </dl>
            <div className={styles.urlBox}>
              <div className={styles.urlHeader}>
                <span className="mono tiny caps">Server URL</span>
                <button type="button" onClick={copyUrl} disabled={copyState === 'copying'} className={styles.copy}>
                  {copyState === 'copied' ? 'Copied' : 'Copy URL'}
                </button>
              </div>
              <input aria-label="Server URL" readOnly value={MCP_URL} onFocus={(event) => event.currentTarget.select()} />
            </div>
            <span role="status" className={styles.copyStatus}>
              {copyState === 'failed' ? 'Could not copy. Select and copy the URL above.' : copyState === 'copied' ? 'URL copied.' : ''}
            </span>
            <p>Leave <strong>Client ID</strong> and <strong>Client secret</strong> blank. Choose <strong>Dynamic Client Registration (DCR)</strong> if asked.</p>
            <p>To save foods from photos and log meals, ChatGPT needs <strong>read and write</strong> access. Request <code>kcal:read kcal:write</code>; if a <strong>Scopes</strong> field is shown, enter that full value.</p>
            <p>Review ChatGPT’s connection notice and choose <strong>Create as a plugin</strong>.</p>
          </li>
          <li>
            <h2>Connect your KCAL account</h2>
            <p>Sign in with your KCAL email and the code from your inbox. Confirm the consent page includes <strong>read and write</strong> access before selecting <strong>Allow access</strong>.</p>
            <p>If it only offers read access, cancel and update the connection to request both scopes. Write access lets ChatGPT add, edit, or delete foods and food logs.</p>
          </li>
          <li>
            <h2>Try your connection</h2>
            <p>Install KCAL from your personal Plugins. Start a new conversation, type <strong>@</strong>, and select <strong>KCAL</strong>.</p>
            <blockquote>Use KCAL to show my totals for today.</blockquote>
          </li>
          <li>
            <h2>Add a food from a photo</h2>
            <p>Attach a photo of the product — even the front of the packaging — and ask:</p>
            <blockquote>Find this product’s barcode and nutrition per 100 g or ml. Show me the values to check before saving it to my KCAL food library.</blockquote>
            <p>Confirm the product and values, then ask ChatGPT to save it. To log a portion, follow up with something like <strong>“Log 150 g of it for today.”</strong></p>
          </li>
        </ol>

        <aside className={styles.help}>
          <h2>Need a hand?</h2>
          <p><strong>Still missing Add custom MCP server?</strong> Availability depends on your account and workspace permissions. Use ChatGPT on the web; if you’re in a managed workspace, check with your administrator.</p>
          <p><strong>ChatGPT can read but cannot save?</strong> Reconnect KCAL and request both scopes: <code>kcal:read kcal:write</code>. Approve only when the consent page includes read and write access.</p>
          <a href="https://developers.openai.com/api/docs/guides/custom-mcp-server" target="_blank" rel="noopener noreferrer">OpenAI’s connection guide <ArrowRightIcon size={14} /></a>
        </aside>

        <a className={`btn-primary ${styles.openChatGPT}`} href="https://chatgpt.com/" target="_blank" rel="noopener noreferrer">
          Open ChatGPT <ArrowRightIcon />
        </a>
      </div>
    </>
  );
}
