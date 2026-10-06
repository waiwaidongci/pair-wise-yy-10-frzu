/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{vue,js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Avenir Next", "PingFang SC", "sans-serif"],
      },
      colors: {
        graphite: "#20242a",
        mist: "#eef1f4",
      },
    },
  },
  plugins: [],
};
