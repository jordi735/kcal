import styles from './TransientErrorToast.module.css';

type TransientErrorToastProps = {
  message: string | null;
  exiting: boolean;
};

export function TransientErrorToast({ message, exiting }: TransientErrorToastProps) {
  if (message === null) return null;
  return (
    <div className={`${styles.toast} mono tiny caps${exiting ? ' fullscreen-exit' : ''}`}>
      {message}
    </div>
  );
}
