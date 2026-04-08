/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./public/**/*.html", "./public/**/*.js"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        redsec: {
          50: "#ffebee",
          100: "#ffcdd2",
          200: "#ef9a9a",
          300: "#e57373",
          400: "#ef5350",
          500: "#E53935",
          600: "#d32f2f",
          700: "#c62828",
          800: "#b71c1c",
          900: "#8e0000",
        },
      },
    },
  },
  plugins: [],
};
