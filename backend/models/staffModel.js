import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { hashPassword } from "../utils/hashPassword.js";

const staffSchema = mongoose.Schema(
    {
        email: {type: String, required: true, unique: true, trim: true, lowercase: true, maxlength: 254},
        name: {type: String, required: false},
        phone: {type: String, required: false},
        password: {type: String, required: true},
        role: {type: String},
        salary: {type: mongoose.Decimal128},
        hireDate: {type: Date, default: Date.now},
        isAdmin: {type: Boolean, default: false},
        isActive: {type: Boolean, default: true},
        authVersion: {type: Number, default: 0, min: 0},
    }
);
staffSchema.pre("save", async function(){
    if(!this.isModified("password")){return;}

    this.password= await hashPassword(this.password);
});

//ham matchPasword
staffSchema.methods.matchPassword = async function (enteredPassword){
    return await bcrypt.compare(enteredPassword, this.password);
};
const Staff = mongoose.model("Staff", staffSchema, "staff");
export default Staff;
