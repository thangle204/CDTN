import React, { useState } from "react";
import { Container, Row, Col, Button, Card, Image, Form } from "react-bootstrap";
import { Minus, Plus, Trash2, Search, CheckSquare, Square } from "lucide-react";
import "bootstrap/dist/css/bootstrap.min.css";

// Component Header
const Header = () => (
    <Row className="mb-4 align-items-center border-bottom pb-3">
        <Col xs="auto">
            <Image src="Logo_home.png" alt="Logo" height={50} />
        </Col>
        <Col>
            <h2 className="fw-bold">🛒 GIỎ HÀNG CỦA BẠN</h2>
        </Col>
        <Col xs={4}>
            <Form className="d-flex">
                <Form.Control type="text" placeholder="Tìm sản phẩm, thương hiệu..." className="me-2" />
                <Button variant="outline-secondary">
                    <Search size={20} />
                </Button>
            </Form>
        </Col>
    </Row>
);
const CartHeader = ({ allChecked, onToggleAll }) => (
    <Row className="border-bottom fw-bold text-muted text-center py-0">
        <Col xs={1}>
            <input type="checkbox" checked={allChecked} onChange={onToggleAll} />
        </Col>
        <Col xs={5} className="text-start">Sản Phẩm</Col>
        <Col xs={2} style={{ paddingLeft: "70px" }}>Đơn Giá</Col>
        <Col xs={2} style={{ paddingLeft: "60px" }}>Số Lượng</Col>
        <Col xs={1}>Thao Tác</Col>
    </Row>
);


// Component hiển thị từng sản phẩm
const CartItem = ({ item, onQuantityChange, onToggleCheck, onRemove }) => (
    <Card className="p-3 shadow-sm mb-3"
        style={{
            border: "1px solid #ddd", // Viền xám nhạt
            borderRadius: "8px" // Bo góc nhẹ
        }}>
        <Row className="align-items-center">
            <Col xs="auto" onClick={() => onToggleCheck(item.id)} style={{ cursor: "pointer" }}>
                {item.checked ? <CheckSquare size={24} /> : <Square size={24} />}
            </Col>
            <Col xs={3} md={2}>
                <Image src={item.image} alt={item.name} fluid rounded />
            </Col>
            <Col md={4}>
                <h5 className="fw-bold">{item.name}</h5>
                <p className="text-muted mb-1">Size: {item.category}</p>
            </Col>
            <Col xs={6} md={2} className="text-center">
                <p className="fw-bold text-danger fs-5">{item.price.toLocaleString()}đ</p>
                <p className="text-decoration-line-through text-muted">
                    {item.oldPrice.toLocaleString()}đ
                </p>
                <p className="text-danger fw-bold">[-{item.discount}%]</p>
            </Col>
            <Col xs={6} md={2} className="d-flex align-items-center justify-content-center">
                <Button variant="light" onClick={() => onQuantityChange(item.id, -1)}>
                    <Minus size={16} />
                </Button>
                <span className="px-3 fs-5">{item.quantity}</span>
                <Button variant="light" onClick={() => onQuantityChange(item.id, 1)}>
                    <Plus size={16} />
                </Button>
            </Col>
            <Col xs="auto">
                <Button variant="danger" className="p-2" onClick={() => onRemove(item.id)}>
                    <Trash2 size={20} />
                </Button>
            </Col>
        </Row>
    </Card>
);


// Component Footer (Tổng tiền và nút thanh toán)
const Footer = ({ total }) => (
    <Card
        className="p-3 shadow-sm"
        style={{
            position: "fixed",
            bottom: "50px", // Cách lề dưới 100px
            left: "50%", // Căn giữa theo chiều ngang
            transform: "translateX(-50%)", // Dịch về giữa
            width: "100%", // Giữ nguyên chiều rộng
            maxWidth: "1200px", // Giới hạn tối đa
            zIndex: 10,
            backgroundColor: "white",
            boxShadow: "0px -2px 10px rgba(0, 0, 0, 0.1)", // Đổ bóng nhẹ
            borderRadius: "10px", // Bo góc đẹp hơn
        }}
    >
        <Row className="justify-content-between align-items-center">
            <Col>
                <p className="fs-5 mb-0">
                    Tổng tiền: <span className="text-danger fw-bold fs-4">{total.toLocaleString()}đ</span>
                </p>
            </Col>
            <Col xs="auto">
                <Button variant="danger" className="px-4 py-2 fs-5">Thanh toán</Button>
            </Col>
        </Row>
    </Card>
);

// Component Cart chính
const Cart = () => {
    const [cartItems, setCartItems] = useState([
        {
            id: 1,
            name: "Giày Adidas Superstar II White/Red",
            category: "Size 42",
            price: 3100000,
            oldPrice: 3650000,
            discount: 15,
            quantity: 1,
            image: "12.webp",
            checked: true,
        },
        {
            id: 2,
            name: "Giày Nike SB Force 58 Light Bone",
            category: "Size 40",
            price: 2250000,
            oldPrice: 2850000,
            discount: 21,
            quantity: 1,
            image: "12.webp",
            checked: true,
        },
        {
            id: 3,
            name: "Giày Onitsuka Tiger Entry Court White Blue",
            category: "Size 42",
            price: 2450000,
            oldPrice: 3150000,
            discount: 22,
            quantity: 1,
            image: "12.webp",
            checked: true,
        },
        {
            id: 4,
            name: "Giày Adidas Superstar II White/Red",
            category: "Size 42",
            price: 3100000,
            oldPrice: 3650000,
            discount: 15,
            quantity: 1,
            image: "12.webp",
            checked: true,
        },
        {
            id: 5,
            name: "Giày Adidas Superstar II White/Red",
            category: "Size 42",
            price: 3100000,
            oldPrice: 3650000,
            discount: 15,
            quantity: 1,
            image: "12.webp",
            checked: true,
        },
        {
            id: 6,
            name: "Giày Adidas Superstar II White/Red",
            category: "Size 38",
            price: 3100000,
            oldPrice: 3650000,
            discount: 15,
            quantity: 1,
            image: "12.webp",
            checked: true,
        },
        
    ]);
    const allChecked = cartItems.length > 0 && cartItems.every(item => item.checked);
    const handleToggleAll = () => {
        setCartItems(cartItems.map(item => ({ ...item, checked: !allChecked })));
    };


    // Xử lý tăng/giảm số lượng
    const handleQuantityChange = (id, delta) => {
        setCartItems((items) =>
            items.map((item) =>
                item.id === id ? { ...item, quantity: Math.max(1, item.quantity + delta) } : item
            )
        );
    };

    // Xử lý chọn/bỏ chọn sản phẩm
    const handleToggleCheck = (id) => {
        setCartItems((items) =>
            items.map((item) =>
                item.id === id ? { ...item, checked: !item.checked } : item
            )
        );
    };

    // Xử lý xóa sản phẩm
    const handleRemoveItem = (id) => {
        setCartItems((items) => items.filter((item) => item.id !== id));
    };

    // Tính tổng tiền
    const totalAmount = cartItems
        .filter((item) => item.checked)
        .reduce((sum, item) => sum + item.price * item.quantity, 0);

    return (
        <div style={{ backgroundImage: "url('/giohang.jpg')", minHeight: "100vh" }}>
            <Container className="py-4" style={{ paddingBottom: "80px" }} >
                <Header />
                <CartHeader allChecked={allChecked} onToggleAll={handleToggleAll} />
                <div
                    style={{
                        maxHeight: "550px",
                        overflowY: "auto",
                        paddingRight: "10px",
                        border: "1px solid #ddd", // Viền xám nhạt
                        // borderRadius: "8px", // Bo góc nhẹ
                        padding: "10px", // Thêm khoảng cách bên trong
                        backgroundColor: "#fff" // Nền trắng để rõ viền hơn
                    }}
                >
                    {cartItems.map((item) => (
                        <CartItem
                            key={item.id}
                            item={item}
                            onQuantityChange={handleQuantityChange}
                            onToggleCheck={handleToggleCheck}
                            onRemove={handleRemoveItem}
                        />
                    ))}
                </div>
                <Footer total={totalAmount} />
            </Container>
        </div>

    );
};

export default Cart;
















