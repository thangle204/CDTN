import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { hashPassword } from "../utils/hashPassword.js";

const cartItemSchema = mongoose.Schema({
    productId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        ref: 'Product',
    },
    quantity: { 
        type: Number, 
        required: true,
        default: 1
    },
});

const userSchema = mongoose.Schema(
    {
        username: { 
            type: String, 
            required: true, 
            unique: true 
        },
        email: { 
            type: String, 
            required: true, 
            unique: true 
        },
        password: { 
            type: String, 
            required: true 
        },
        phone: { 
            type: String, 
            required: false 
        },
        isAdmin: { 
            type: Boolean, 
            default: false 
        },
        cart: [cartItemSchema],
    },
    {
        timestamps: true,
    }
);

// Hash password trước khi save
userSchema.pre("save", async function () {
    if (!this.isModified("password")) {
        return;
    }
    this.password = await hashPassword(this.password);
});

// So sánh password
userSchema.methods.matchPassword = async function (enteredPassword) {
    return await bcrypt.compare(enteredPassword, this.password);
};

const User = mongoose.model('User', userSchema);
export default User;
