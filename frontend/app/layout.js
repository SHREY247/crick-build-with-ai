import "./globals.css";

export const metadata = {
  title: "StadiumSync — AI Live Commentary Rooms for Cricket",
  description: "Point your camera at a cricket match, choose a commentary personality, and share the live AI commentary room with friends. Powered by Gemini Vision.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
