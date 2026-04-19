import styles from './BrandMark.module.css';

export function BrandMark() {
  return (
    <div className={styles.brand}>
      <span className={`mono ${styles.wordmark}`}>kcal.</span>
      <span className={`mono tiny caps ${styles.version}`}>v1</span>
    </div>
  );
}
