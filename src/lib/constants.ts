/** The type identifier for the Pastr webview view. */
export const PASTR_VIEW_TYPE = 'pastr-view';
/** The filename for the generated context file. */
export const CONTEXT_FILENAME = 'codebase.md';
/** The emoji prefix used for all Pastr-related notifications. */
export const PAST_EMOJI = '✨ Pastr:';

/** Default patterns to exclude from file export. */
export const DEFAULT_EXCLUDE_PATTERNS = [
    // Build and dependency directories
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/.next/**',
    '**/.nuxt/**',
    '**/.svelte-kit/**',
    '**/out/**',
    '**/target/**',

    // Version control and IDE
    '**/.git/**',
    '**/.vscode/**',
    '**/.idea/**',

    // OS files
    '**/.DS_Store',
    '**/Thumbs.db',

    // Log files
    '**/*.log',
    '**/logs/**',

    // Lock files
    '**/package-lock.json',
    '**/yarn.lock',
    '**/pnpm-lock.yaml',
    '**/composer.lock',
    '**/Pipfile.lock',
    '**/poetry.lock',
    '**/Cargo.lock',

    // Environment and config files
    '**/.env',
    '**/.env.*',
    '**/.npmrc',
    '**/.yarnrc',
    '**/.prettierrc',
    '**/.prettierrc.*',
    '**/.prettierignore',
    '**/.eslintrc',
    '**/.eslintrc.*',
    '**/.eslintignore',
    '**/.editorconfig',
    '**/.gitignore',
    '**/.gitattributes',

    // Cache directories
    '**/.cache/**',
    '**/tmp/**',
    '**/temp/**',
    '**/.tmp/**',
    '**/.temp/**',
];

/** File extensions for binary files to be excluded from export. */
export const BINARY_FILE_EXTENSIONS = [
    // Images
    '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.ico', '.bmp', '.tiff', '.tif',
    '.avif', '.heic', '.heif',

    // Videos
    '.mp4', '.mov', '.avi', '.webm', '.mkv', '.flv', '.wmv', '.m4v',

    // Audio
    '.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.wma',

    // Fonts
    '.woff', '.woff2', '.ttf', '.otf', '.eot',

    // Documents
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.odt', '.ods', '.odp',

    // Archives
    '.zip', '.tar', '.gz', '.rar', '.7z', '.bz2', '.xz', '.dmg', '.pkg',

    // Executables and libraries
    '.exe', '.dll', '.so', '.dylib', '.class', '.jar', '.war', '.ear',
    '.app', '.deb', '.rpm', '.msi',

    // Database files
    '.db', '.sqlite', '.sqlite3', '.mdb',

    // Other binary formats
    '.bin', '.dat', '.iso', '.img',
];