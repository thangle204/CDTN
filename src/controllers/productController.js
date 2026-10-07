const db = require("../config/db"); // Import kết nối DB
const fs = require("fs");
const path = require("path");

const getAllProducts = async (req, res) => {
  try {
    // Lấy tất cả sản phẩm
    const [products] = await db.query(
      "SELECT product_id, name, description, price, image, brand, stock, discount FROM products"
    );

    

    // Log thông tin sản phẩm
    console.log("Sản phẩm từ DB:", {
      totalProducts: products.length,
      sampleProduct: products[0],
    });

    // Kiểm tra file ảnh
    products.forEach((product) => {
      if (product.image) {
        const imagePath = path.join(__dirname, "..", "uploads", product.image);
        console.log(`Kiểm tra ảnh ${product.name}:`, {
          imagePath,
          exists: fs.existsSync(imagePath),
        });
      }
    });

    res.json({
      success: true,
      data:  products,
    });
  } catch (error) {
    console.error("Lỗi khi lấy danh sách sản phẩm:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi khi lấy danh sách sản phẩm",
      error: error.message,
    });
  }
};

// Lấy sản phẩm theo ID
const getProductById = async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Getting product details for ID:", id);

    // Lấy thông tin sản phẩm
    const [product] = await db.query(
      "SELECT * FROM products WHERE product_id = ?",
      [id]
    );

    console.log("Product data from DB:", product[0]);

    if (!product[0]) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy sản phẩm",
      });
    }

    // Lấy variants của sản phẩm
    const [variants] = await db.query("SELECT * FROM productvariants WHERE product_id = ?", [id]);

    console.log("Variants from DB:", variants);

    // Không chặn lỗi nếu không có variants, để Admin vẫn sửa được thông tin cơ bản
    const productData = {
      ...product[0],
      variants: variants || [],
    };

    console.log("Final product data:", {
      productId: id,
      variantsCount: variants.length,
      firstVariant: variants[0],
    });

    res.json({
      success: true,
      data: productData,
      variants: variants,
    });
  } catch (error) {
    console.error("Error getting product details:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi khi lấy chi tiết sản phẩm",
      error: error.message,
    });
  }
};

// Thêm sản phẩm mới
const createProduct = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction(); 

    const { name, description, price, category_id, brand, discount } = req.body;
    const image = req.file ? req.file.filename : null;

    // 1. KIỂM TRA MẢNG BIẾN THỂ RẤT NGHIÊM NGẶT
    if (!req.body.variants) {
      throw new Error("Không nhận được dữ liệu biến thể từ máy khách!");
    }
    
    let variants = [];
    try {
      variants = JSON.parse(req.body.variants);
    } catch (parseError) {
      throw new Error("Lỗi định dạng dữ liệu biến thể!");
    }

    if (!name || !price || !image || variants.length === 0) {
      throw new Error("Vui lòng điền đủ Tên, Giá, Ảnh và ít nhất 1 Size/Màu!");
    }

    // 2. LƯU SẢN PHẨM (Tổng stock tạm để là 0)
    const [productResult] = await connection.query(
      "INSERT INTO products (name, description, price, category_id, brand, image, discount, stock) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [name, description, parseFloat(price), parseInt(category_id) || 1, brand, image, parseInt(discount) || 0, 0]
    );

    const productId = productResult.insertId;
    let totalStock = 0;

    // 3. LƯU TỪNG SIZE/MÀU VÀO DB
    for (const v of variants) {
      const vStock = parseInt(v.stock) || 0;
      totalStock += vStock;
      await connection.query(
        "INSERT INTO productvariants (product_id, size, color, stock) VALUES (?, ?, ?, ?)",
        [productId, String(v.size), String(v.color), vStock]
      );
    }

    // 4. CỘNG DỒN TỔNG KHO VÀO SẢN PHẨM CHÍNH
    await connection.query("UPDATE products SET stock = ? WHERE product_id = ?", [totalStock, productId]);

    await connection.commit(); 
    res.status(201).json({ success: true, message: "Thêm sản phẩm và biến thể thành công!" });

  } catch (error) {
    await connection.rollback(); 
    console.error("LỖI KHI THÊM SẢN PHẨM:", error.message);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    connection.release();
  }
};

// Cập nhật sản phẩm
const updateProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, price, brand, stock, discount } = req.body;

    // 1. Tìm thông tin sản phẩm cũ để lấy tên ảnh cũ
    const [oldProduct] = await db.query("SELECT image FROM products WHERE product_id = ?", [id]);
    if (oldProduct.length === 0) {
      return res.status(404).json({ success: false, message: "Không tìm thấy sản phẩm để cập nhật" });
    }
    const oldImage = oldProduct[0].image;

    // 2. Gom dữ liệu text và ép kiểu chuẩn xác
    let updates = {};
    if (name !== undefined) updates.name = name.trim();
    if (description !== undefined) updates.description = description.trim();
    if (price !== undefined) updates.price = parseFloat(price) || 0;
    if (brand !== undefined) updates.brand = brand.trim();
    if (stock !== undefined) updates.stock = parseInt(stock) || 0;
    if (discount !== undefined) updates.discount = parseInt(discount) || 0;

    // 3. Xử lý ảnh mới: Nếu có file mới được tải lên qua Multer
    if (req.file) {
      updates.image = req.file.filename; // Gán tên file ảnh mới

      // TỰ ĐỘNG DỌN RÁC: Xóa file ảnh cũ nếu nó là file local trong folder uploads
      if (oldImage && !oldImage.startsWith("http")) {
        const oldImagePath = path.join(__dirname, "..", "uploads", oldImage);
        if (fs.existsSync(oldImagePath)) {
          fs.unlinkSync(oldImagePath); // Xóa file cũ
          console.log(`Đã xóa file ảnh cũ khỏi hệ thống: ${oldImage}`);
        }
      }
    }

    // 4. Lọc bỏ các dữ liệu rỗng (null/undefined)
    const validUpdates = Object.fromEntries(
      Object.entries(updates).filter(([_, value]) => value !== undefined && value !== null)
    );

    if (Object.keys(validUpdates).length === 0) {
      return res.status(400).json({ success: false, message: "Không có dữ liệu hợp lệ để cập nhật" });
    }

    // 5. Tạo câu lệnh SQL cập nhật động
    const fields = Object.keys(validUpdates).map((field) => `${field} = ?`).join(", ");
    const values = Object.values(validUpdates);

    const [result] = await db.query(
      `UPDATE products SET ${fields} WHERE product_id = ?`,
      [...values, id]
    );

    // 6. Trả về thông tin sản phẩm mới nhất sau khi sửa thành công
    const [updatedProduct] = await db.query("SELECT * FROM products WHERE product_id = ?", [id]);

    res.json({
      success: true,
      message: "Sản phẩm đã được cập nhật thành công",
      data: updatedProduct[0],
    });
  } catch (error) {
    console.error("Lỗi khi cập nhật sản phẩm:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi hệ thống khi cập nhật sản phẩm: " + error.message,
    });
  }
};
// Xóa sản phẩm
const deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;

    const [result] = await db.query(
      "DELETE FROM products WHERE product_id = ?",
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy sản phẩm",
      });
    }

    res.json({ success: true, message: "Xóa sản phẩm thành công" });
  } catch (error) {
    console.error("Lỗi khi xóa sản phẩm:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi khi xóa sản phẩm",
    });
  }
};

// Tìm kiếm sản phẩm
const searchProducts = async (req, res) => {
  try {
    const searchQuery = req.query.query;

    if (!searchQuery) {
      return res.status(400).json({
        success: false,
        message: "Thiếu từ khóa tìm kiếm",
      });
    }

    const searchPattern = `%${searchQuery}%`;
    const [products] = await db.query(
      "SELECT * FROM products WHERE name LIKE ? OR brand LIKE ? OR description LIKE ?",
      [searchPattern, searchPattern, searchPattern]
    );

    res.json({ success: true, data: products });
  } catch (error) {
    console.error("Lỗi khi tìm kiếm sản phẩm:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi khi tìm kiếm sản phẩm",
    });
  }
};

// Export các hàm
module.exports = {
  getAllProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  searchProducts,
};
