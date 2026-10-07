const isAdmin = (req, res, next) => {
  if (req.user && req.user.role.toLowerCase() === "admin") {
    next();
  } else {
    res.status(403).json({
      message: "Quyền truy cập bị từ chối. Yêu cầu quyền admin.",
    });
  }
};

module.exports = isAdmin;
