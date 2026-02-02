// ... (tes imports)

export const protect = async (req, res, next) => {
  try {
    let token;

    if (req.cookies && req.cookies.access_token) {
      token = req.cookies.access_token;
    } else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      throw ErrorTypes.Unauthorized('Vous n\'êtes pas connecté');
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // ATTENTION ICI : On utilise decoded.userId car c'est ce qu'on a mis dans le token
    const currentUser = await prisma.user.findUnique({
      where: { id: decoded.userId }, 
      select: {
        id: true,
        email: true,
        isActive: true,
        emailVerified: true
      }
    });

    if (!currentUser) {
      throw ErrorTypes.Unauthorized('L\'utilisateur n\'existe plus');
    }

    if (!currentUser.isActive) {
      throw ErrorTypes.Forbidden('Votre compte a été désactivé');
    }

    req.user = currentUser;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      next(ErrorTypes.Unauthorized('Token invalide'));
    } else if (error.name === 'TokenExpiredError') {
      next(ErrorTypes.Unauthorized('Session expirée'));
    } else {
      next(error);
    }
  }
};