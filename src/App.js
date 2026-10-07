import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Header from "./component/Header/Header";
import Main from "./component/Main/Main";
import Login from "./component/login-signup/login";
import Footer from "./component/Footer/footer";
import Signup from "./component/login-signup/signup";
import ShoesDetail from "./component/ShoesDetail/ShoesDetail";
import AdminDashboard from "./component/Admin/AdminDashboard";
import AdminProducts from "./component/Admin/AdminProducts";
import EditProduct from "./component/Admin/EditProduct";
import AdminAddProduct from "./component/Admin/AdminAddProduct";
import AdminOrders from "./component/Admin/AdminOrders";
import AdminUsers from "./component/Admin/AdminUsers";
import Cart from "./component/Cart/Cart";
import { CartProvider } from "./component/Cart/CartContex";
import Orders from "./component/Order/Orders";
import ProtectedRoute from "./routes/ProtectedRoute";
import ChangePassword from "./component/Users/ChangePassword";
import UserProfile from "./component/Users/UserProfile";
import AdminRoute from "./routes/AdminRoute";

function App() {
  return (
    <CartProvider>
      <Router>
        <div className="App">
          <Routes>
            <Route
              path="/"
              element={
                <>
                  <Header />
                  <main className="container">
                    <Main />
                  </main>
                  <Footer />
                </>
              }
            />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />

            <Route path="/product/:id"
             element={
              <div className="container">
                <ShoesDetail />
              </div>
            } />
            <Route path="/admin" element={<AdminRoute><AdminDashboard /></AdminRoute>} />
            <Route path="/admin/products" element={<AdminRoute><AdminProducts /></AdminRoute>} />
            <Route path="/admin/products/edit/:id" element={<AdminRoute><EditProduct /></AdminRoute>} />
            <Route path="/admin/products/add" element={<AdminRoute><AdminAddProduct /></AdminRoute>} />
            <Route path="/admin/orders" element={<AdminRoute><AdminOrders /></AdminRoute>} />
            <Route path="/admin/users" element={<AdminRoute><AdminUsers /></AdminRoute>} />
            <Route path="/user/profile" element={<UserProfile />} />

            <Route
              path="/cart"
              element={
                <ProtectedRoute>
                  <Cart />
                </ProtectedRoute>
              }
            />
            <Route
              path="/orders"
              element={
                <ProtectedRoute>
                  <Orders />
                </ProtectedRoute>
              }
            />
            <Route
              path="/change-password"
              element={
                <ProtectedRoute>
                  <ChangePassword />
                </ProtectedRoute>
              }
            />
          </Routes>
        </div>
      </Router>
    </CartProvider>
  );
}

export default App;
