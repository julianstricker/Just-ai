// Get API base URL from environment variable or default to relative path
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

// Helper function to create full API URLs
export const createApiUrl = (path: string): string => {
  if (!path.startsWith('/')) {
    path = '/' + path;
  }
  return API_BASE_URL + path;
};
