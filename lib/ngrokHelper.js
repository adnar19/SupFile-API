import axios from 'axios';

export const getNgrokUrl = async () => {
  // Si on est en production, on utilise l'URL fixe
  if (process.env.NODE_ENV === 'production') {
    return process.env.FRONTEND_URL;
  }

  try {
    // Ngrok expose une API locale sur le port 4040
    const response = await axios.get('http://127.0.0.1:4040/api/tunnels');
    const publicUrl = response.data.tunnels[0].public_url;
    console.log(`📡 URL Ngrok détectée automatiquement : ${publicUrl}`);
    return publicUrl;
  } catch (error) {
    console.log('⚠️ Ngrok n\'est pas lancé, utilisation de localhost');
    return 'http://localhost:3000';
  }
};