module.exports = function ping(mount) {
    mount = mount || '/ping';
    return function pinger(req, res, next) {
        if (req.url === mount) {
            res.json({
                message: "Hey",
                success: true
            });
        } else {
            next();
        }
    }
}