const IS_MAC = navigator.userAgent.includes("Mac");

/**
 * Shown in place of a folder the system won't let getit read. On macOS that's
 * usually a privacy-protected folder (Documents, Desktop, ...): choosing it in an
 * Open panel lets getit in, and System Settings can allow it for good.
 */
export function NoAccess({
  name,
  asked,
  onGrant,
  onSettings,
}: {
  /** The folder's name, such as "Documents". */
  name: string;
  /** Whether the user already tried granting access to this folder. */
  asked: boolean;
  onGrant: () => void;
  onSettings: () => void;
}) {
  if (!IS_MAC) return <div className="empty">getit doesn't have permission to open “{name}”.</div>;
  return (
    // Keeps the folder view's marquee and deselection away from the buttons.
    <div className="empty no-access" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <p className="no-access-title">getit can't open “{name}”</p>
      <p>
        {asked
          ? "macOS still isn't letting getit in. Allow getit under Files & Folders (or Full Disk Access) in Privacy & Security, then come back."
          : `macOS protects this folder. Choose it in the next window to let getit open it.`}
      </p>
      <div className="no-access-actions">
        <button className={asked ? "plain-btn" : "primary-btn"} onClick={onGrant}>
          Grant Access…
        </button>
        <button className={asked ? "primary-btn" : "plain-btn"} onClick={onSettings}>
          Open Privacy Settings
        </button>
      </div>
    </div>
  );
}
