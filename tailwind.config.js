/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                'primary': '#007E6E',        // Teal Green (User Requested)
                'primary-dark': '#006558',   // Darker shade
                'primary-light': '#d1fae5',  // Light green background
                'page': '#ffffff',           // White background
                'app-bg': '#f3f3f3',         // Gray app background behind floating cards
                'sidebar': '#ffffff',        // White sidebar
                'bg-white': '#fafafa',          // White background
                'bg-tertiary': '#f3f4f6',    // Slightly darker gray
                'text-primary': '#111827',   // Dark gray text
                'text-secondary': '#6b7280', // Medium gray text
                'text-muted': '#9ca3af',     // Light gray text
                'border': '#e5e7eb',         // Light border
                'border-dark': '#d1d5db',    // Darker border
                // Message colors
                'user-msg': '#f0fdf4',       // Very light green
                'ai-msg': '#f9fafb',         // Light gray
            },
            fontFamily: {
                sans: ['Inter', 'system-ui', 'sans-serif'],
            },
            animation: {
                'typing': 'typing 1.4s infinite',
                'fade-in': 'fadeIn 0.3s ease-in',
                'slide-up': 'slideUp 0.4s ease-out',
                'scale-check': 'scaleCheck 0.3s ease-out',
                'toast-in': 'toastIn 0.3s ease-out',
                'toast-out': 'toastOut 0.2s ease-in forwards',
            },
            keyframes: {
                typing: {
                    '0%, 100%': { opacity: '0.2' },
                    '50%': { opacity: '1' },
                },
                fadeIn: {
                    '0%': { opacity: '0' },
                    '100%': { opacity: '1' },
                },
                slideUp: {
                    '0%': { transform: 'translateY(10px)', opacity: '0' },
                    '100%': { transform: 'translateY(0)', opacity: '1' },
                },
                scaleCheck: {
                    '0%': { transform: 'scale(0)', opacity: '0' },
                    '70%': { transform: 'scale(1.2)' },
                    '100%': { transform: 'scale(1)', opacity: '1' },
                },
                toastIn: {
                    '0%': { transform: 'translateY(-100%)', opacity: '0' },
                    '100%': { transform: 'translateY(0)', opacity: '1' },
                },
                toastOut: {
                    '0%': { transform: 'translateY(0)', opacity: '1' },
                    '100%': { transform: 'translateY(-100%)', opacity: '0' },
                },
            },
        },
    },
    plugins: [
        require('@tailwindcss/typography'),
    ],
}
